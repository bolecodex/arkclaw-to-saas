"""火山引擎 OpenAPI V4 签名实现。"""

import datetime
import hashlib
import hmac
import json
from urllib.parse import quote

import requests


def _hmac_sha256(key: bytes, content: str) -> bytes:
    return hmac.new(key, content.encode("utf-8"), hashlib.sha256).digest()


def _hash_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _norm_query(params: dict) -> str:
    query = ""
    for key in sorted(params.keys()):
        if isinstance(params[key], list):
            for k in params[key]:
                query += quote(key, safe="-_.~") + "=" + quote(k, safe="-_.~") + "&"
        else:
            query += quote(key, safe="-_.~") + "=" + quote(str(params[key]), safe="-_.~") + "&"
    return query[:-1].replace("+", "%20") if query else ""


def volc_request(
    action: str,
    body: dict,
    ak: str,
    sk: str,
    service: str,
    version: str,
    region: str,
    host: str,
    method: str = "POST",
    timeout: int = 15,
) -> dict:
    """向火山引擎 OpenAPI 发送带 V4 签名的请求。"""
    now = datetime.datetime.now(datetime.timezone.utc)
    body_str = json.dumps(body)
    content_type = "application/json"

    x_date = now.strftime("%Y%m%dT%H%M%SZ")
    short_x_date = x_date[:8]
    x_content_sha256 = _hash_sha256(body_str)

    sign_headers = {
        "Host": host,
        "X-Content-Sha256": x_content_sha256,
        "X-Date": x_date,
        "Content-Type": content_type,
    }

    signed_headers_str = ";".join(["content-type", "host", "x-content-sha256", "x-date"])
    query_params = {"Action": action, "Version": version}

    canonical_request = "\n".join([
        method.upper(),
        "/",
        _norm_query(query_params),
        "\n".join([
            "content-type:" + content_type,
            "host:" + host,
            "x-content-sha256:" + x_content_sha256,
            "x-date:" + x_date,
        ]),
        "",
        signed_headers_str,
        x_content_sha256,
    ])

    hashed_canonical_request = _hash_sha256(canonical_request)
    credential_scope = "/".join([short_x_date, region, service, "request"])
    string_to_sign = "\n".join([
        "HMAC-SHA256", x_date, credential_scope, hashed_canonical_request
    ])

    k_date = _hmac_sha256(sk.encode("utf-8"), short_x_date)
    k_region = _hmac_sha256(k_date, region)
    k_service = _hmac_sha256(k_region, service)
    k_signing = _hmac_sha256(k_service, "request")
    signature = _hmac_sha256(k_signing, string_to_sign).hex()

    sign_headers["Authorization"] = (
        f"HMAC-SHA256 Credential={ak}/{credential_scope}, "
        f"SignedHeaders={signed_headers_str}, "
        f"Signature={signature}"
    )

    url = f"https://{host}/"
    resp = requests.request(
        method=method,
        url=url,
        headers=sign_headers,
        params=query_params,
        data=body_str,
        timeout=timeout,
    )
    return resp.json()
