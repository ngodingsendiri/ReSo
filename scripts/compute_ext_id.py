#!/usr/bin/env python3
"""Hitung Chrome extension ID dari RSA signing key (key.pem).

Chrome extension ID = SHA256(public_key_spki_der)[:16]  -> hex -> map ke a-p
0->a 1->b ... 9->j a->k b->l c->m d->n e->o f->p

Usage: python compute_ext_id.py <path-to-key.pem>
Output: extension_id
"""
import sys
import hashlib
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

def compute_ext_id(pem_path: str) -> str:
    with open(pem_path, 'rb') as f:
        pem = f.read()

    key = serialization.load_pem_private_key(pem, password=None)
    pub_der = key.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    digest = hashlib.sha256(pub_der).digest()[:16]

    # Map each hex digit (0-15) to a-p alphabet
    alpha = "abcdefghijklmnop"
    ext_id = "".join(alpha[b >> 4] + alpha[b & 0xF] for b in digest)
    return ext_id

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "extension/dist-crx/reso-extension-key.pem"
    print(compute_ext_id(path))