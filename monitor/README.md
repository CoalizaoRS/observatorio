# Monitor de Planos de Contingência — RS

Varre os sites oficiais dos 497 municípios do Rio Grande do Sul em busca do
Plano de Contingência (Defesa Civil) e avisa por e-mail quando encontra uma
versão nova ou alterada.

Faz parte do monorepo do [Observatório da Resiliência Climática](../README.md);
este diretório (`monitor/`) é autocontido — todos os caminhos abaixo são
relativos a ele.

## Como funciona

1. **Lista de municípios** (`municipios_rs.json`): gerada a partir da API de
   localidades do IBGE. Para cada município, é montada uma URL candidata
   seguindo a convenção mais comum entre as prefeituras do RS:
   `https://www.<slug>.rs.gov.br` (slug = nome sem acentos/espaços).

   **Essa convenção não vale para todos os 497 municípios.** Muitos usam
   domínios próprios, o padrão `.gov.br` unificado, ou hospedagem terceirizada.
   Use `overrides.json` para corrigir manualmente a URL de um município à
   medida que forem identificados casos assim (o script reporta como "site
   inacessível" quem não resolve por nenhuma variante testada).

2. **Busca do plano** (`monitor.py`): em cada site, procura links cujo texto
   ou URL contenha termos como "contingência", "PLCON", "defesa civil" etc.
   Se o link não for um PDF direto, entra em até 5 subpáginas candidatas
   procurando o PDF.

3. **Validação de conteúdo**: a busca por palavra-chave no HTML (passo 2) gera
   falsos positivos — links de editais, leis ou cartilhas que mencionam
   "defesa civil" de passagem, sem serem o plano em si. Por isso, todo PDF
   baixado tem o texto extraído (`pypdf`) e só é aceito como plano de
   contingência válido se contiver literalmente o termo **"Plano de
   Contingência"** (comparação sem acentos/maiúsculas).

   Quando a extração normal não acha o termo e trouxe pouco ou nenhum texto
   (< 50 caracteres — indício de PDF digitalizado/imagem), o script tenta
   **OCR** (`pymupdf` para rasterizar as páginas + `tesseract`/`pytesseract`,
   em português, até 10 páginas) antes de desistir. Isso recupera planos que
   são só um scan sem camada de texto — na primeira leva de 497 municípios,
   3 dos 15 "falsos positivos sem texto" eram na verdade planos legítimos e
   só foram confirmados depois do OCR.

   Se, mesmo com OCR (ou sem OCR disponível no ambiente), o termo não for
   encontrado, o documento é descartado como falso positivo: fica fora do
   `state.json` como plano válido, é registrado em `falso_positivo` no estado
   e o arquivo vai para `changed_pdfs/falsos_positivos/` para conferência
   manual.

4. **Detecção de mudança**: usa primeiro os headers HTTP (`ETag`,
   `Last-Modified`, `Content-Length`) como triagem rápida; quando há sinal de
   mudança (ou não há headers confiáveis), baixa o PDF, valida o conteúdo
   (passo 3) e só então compara o hash SHA-256 com a versão anterior salva em
   `state.json`.

5. **Estado persistido** (`state.json`): fica versionado no repositório.
   Guarda, por município, a URL do site, a URL do plano, o hash, headers HTTP
   e datas de primeira detecção / última mudança / última verificação. **Não
   guarda o conteúdo do PDF** (para não inchar o repo).

6. **Notificação por e-mail**: quando há pelo menos uma mudança, envia um
   e-mail-resumo (digest) com a lista de municípios afetados. Não envia nada
   se não houver mudanças.

## Pré-requisitos

Além das dependências Python (`requirements.txt`), o OCR de fallback precisa
do binário do **tesseract** instalado no sistema (com o pacote de idioma
português):

```bash
# macOS
brew install tesseract tesseract-lang

# Debian/Ubuntu (mesmo comando usado no workflow do GitHub Actions)
sudo apt-get install -y tesseract-ocr tesseract-ocr-por
```

Sem o tesseract instalado, o monitor funciona normalmente — só pula o OCR e
trata PDFs sem texto extraível diretamente como falso positivo (fica um aviso
no log avisando disso).

## Rodando localmente

```bash
cd monitor   # a partir da raiz do repo
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# teste rápido com poucos municípios, sem enviar e-mail
python monitor.py --limit 10 --dry-run

# um município específico
python monitor.py --municipio "Lajeado" --dry-run

# reavalia o conteúdo dos PDFs já baixados em changed_pdfs/, sem acessar a
# rede (útil depois de ajustar o termo de validação, por exemplo)
python monitor.py --validar-existentes

# rodada completa (leva alguns minutos; ~497 sites)
python monitor.py
```

Para enviar e-mail localmente, exporte as variáveis antes de rodar (veja
"Configuração de e-mail" abaixo) e não use `--dry-run`.

## Rodando automaticamente (GitHub Actions)

O workflow `../.github/workflows/monitor.yml` (na raiz do repo) já está
configurado para rodar todo dia às 08:00 (horário de Brasília) e também pode
ser disparado manualmente pela aba **Actions** do GitHub
(`workflow_dispatch`).

### Configuração de e-mail (Resend)

O digest é enviado via API HTTP do [Resend](https://resend.com) — sem
SMTP, sem guardar senha de e-mail, só uma API key escopada só para envio
(gratuito até 3.000 e-mails/mês, mais que suficiente pra no máximo 1
e-mail/dia).

1. Crie uma conta em resend.com e gere uma API key (**API Keys → Create API
   Key**, com permissão só de "Sending").
   - Para o campo `from`, dá pra usar `onboarding@resend.dev` sem configurar
     nada (funciona em modo de teste, mas só entrega para o e-mail da própria
     conta Resend). Para enviar para qualquer destinatário, verifique um
     domínio próprio em **Domains** (ex.: um subdomínio de
     `observatoriodaresiliencia.org`) e use um endereço desse domínio.
2. Em **Settings → Secrets and variables → Actions** do repositório
   `CoalizaoRS/observatorio`, cadastre:
   - `RESEND_API_KEY` — a API key gerada no passo 1
   - `EMAIL_FROM` — o remetente (ex.: `onboarding@resend.dev` ou um endereço
     do domínio verificado)
   - `EMAIL_TO` — endereço(s) que recebem o digest (aceita uma lista
     separada por vírgula)

O workflow já tem `permissions: contents: write` para commitar o
`state.json` atualizado de volta no repositório a cada execução.

Sem esses secrets configurados, o monitor roda normalmente e só imprime o
relatório no log da Action (nenhum e-mail é enviado).

## Corrigindo a URL de um município

Edite `overrides.json`:

```json
{
  "Nome Exato Do Município": {
    "site_base": "https://url-correta-do-site.rs.gov.br"
  }
}
```

Para excluir um município da varredura (ex.: site permanentemente fora do
ar), use `{"skip": true}` no lugar de `site_base`.

## Limitações conhecidas

- A cobertura inicial depende da convenção de URL; espere uma taxa
  significativa de "site inacessível" na primeira rodada para municípios que
  fogem do padrão — isso é esperado e se corrige incrementalmente via
  `overrides.json`.
- Sites de prefeitura mudam de estrutura com frequência; a busca por
  palavras-chave pode falhar em encontrar o plano mesmo quando ele existe.
  Nesses casos o status fica como "plano não encontrado", não é tratado como
  erro fatal.
- `verify=False` é usado nas requisições porque é comum prefeituras terem
  certificados SSL expirados/mal configurados. Isso desabilita a validação de
  certificado para esses domínios — aceitável aqui porque o conteúdo baixado
  (PDFs públicos) é verificado por hash, não por confiança no canal.
- A validação de conteúdo (passo 3 acima) exige o termo exato "Plano de
  Contingência" no texto extraído do PDF. Isso descarta corretamente editais e
  leis que só mencionam "defesa civil" de passagem, mas também descarta PDFs
  digitalizados sem camada de texto (imagem pura) mesmo quando são o plano de
  fato — nesse caso ele cai em `changed_pdfs/falsos_positivos/` para
  conferência manual, com o motivo registrado em `falso_positivo` no
  `state.json`.
