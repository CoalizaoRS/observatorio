"""Transferências com o Garage (S3) usadas pelos jobs do cluster.

  s3sync.py exists <bucket> <chave>                # código de saída 0 se existir
  s3sync.py put  <arquivo-local> <bucket> <chave>
  s3sync.py get  <bucket> <chave> <arquivo-local>
  s3sync.py pull <bucket> <prefixo> <dir-local>    # baixa só o que mudou (ETag)
  s3sync.py push <dir-local> <bucket> <prefixo>    # sobe só o que mudou (MD5)

Credenciais em ~/observatorio-rag/garage.env (chave pantanal-rag).
"""
import hashlib, sys
from pathlib import Path

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config

ENV_FILE = Path.home() / "observatorio-rag" / "garage.env"
# Multipart quebra a igualdade ETag == MD5; arquivos até 8 GB sobem numa parte só.
XFER = TransferConfig(multipart_threshold=8 * 2**30)


def client():
    env = dict(l.strip().split("=", 1) for l in open(ENV_FILE) if "=" in l)
    return boto3.client(
        "s3",
        endpoint_url=env["S3_ENDPOINT"],
        region_name=env["S3_REGION"],
        aws_access_key_id=env["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
        config=Config(s3={"addressing_style": "path"}),
    )


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def listar(s3, bucket, prefixo):
    out = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefixo):
        for o in page.get("Contents", []):
            out[o["Key"]] = o["ETag"].strip('"')
    return out


def main():
    cmd, *a = sys.argv[1:]
    s3 = client()
    if cmd == "put":
        s3.upload_file(a[0], a[1], a[2], Config=XFER)
    elif cmd == "exists":
        sys.exit(0 if a[1] in listar(s3, a[0], a[1]) else 1)
    elif cmd == "get":
        Path(a[2]).parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(a[0], a[1], a[2])
    elif cmd == "pull":
        bucket, prefixo, destino = a[0], a[1], Path(a[2])
        n = 0
        for key, etag in listar(s3, bucket, prefixo).items():
            local = destino / key[len(prefixo):].lstrip("/")
            if local.exists() and md5(local) == etag:
                continue
            local.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(bucket, key, str(local))
            n += 1
        print(f"pull {bucket}/{prefixo}: {n} arquivo(s) baixado(s)")
    elif cmd == "push":
        origem, bucket, prefixo = Path(a[0]), a[1], a[2].rstrip("/")
        remoto = listar(s3, bucket, prefixo)
        n = 0
        for p in sorted(origem.rglob("*")):
            if not p.is_file():
                continue
            key = f"{prefixo}/{p.relative_to(origem).as_posix()}"
            if remoto.get(key) == md5(p):
                continue
            s3.upload_file(str(p), bucket, key, Config=XFER)
            n += 1
        print(f"push {bucket}/{prefixo}: {n} arquivo(s) enviado(s)")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
