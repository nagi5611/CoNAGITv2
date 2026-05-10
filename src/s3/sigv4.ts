/**
 * src/s3/sigv4.ts — AWS Signature Version 4 (S3 presigned URLs + small signed requests)
 */

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return toHex(hash);
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  data: string | Uint8Array,
): Promise<ArrayBuffer> {
  const keyBuf = key instanceof ArrayBuffer ? new Uint8Array(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const dataBuf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return crypto.subtle.sign("HMAC", cryptoKey, dataBuf);
}

async function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(
    new TextEncoder().encode(`AWS4${secretAccessKey}`),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

/** RFC 3986 except S3 relaxes slash in object key path segments. */
export function awsUriEncode(input: string, encodeSlash = false): string {
  const enc = new TextEncoder();
  let out = "";
  for (const b of enc.encode(input)) {
    if (
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      (b >= 0x30 && b <= 0x39) ||
      b === 0x2d ||
      b === 0x2e ||
      b === 0x5f ||
      b === 0x7e
    ) {
      out += String.fromCharCode(b);
    } else if (b === 0x2f && !encodeSlash) {
      out += "/";
    } else {
      out += `%${b.toString(16).padStart(2, "0").toUpperCase()}`;
    }
  }
  return out;
}

function formatAmzDate(d: Date): { amzDate: string; dateStamp: string } {
  const iso = d.toISOString();
  const dateStamp = iso.slice(0, 10).replace(/-/g, "");
  const amzDate = `${dateStamp}T${iso.slice(11, 19).replace(/:/g, "")}Z`;
  return { amzDate, dateStamp };
}

function canonicalUriForKey(key: string): string {
  if (!key) return "/";
  return `/${key.split("/").map((s) => awsUriEncode(s, false)).join("/")}`;
}

function sortEncodeQuery(params: Array<[string, string]>): string {
  const sorted = [...params].sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
  );
  return sorted
    .map(([k, v]) => `${awsUriEncode(k, true)}=${awsUriEncode(v, true)}`)
    .join("&");
}

export type PresignPutParams = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  objectKey: string;
  expiresSeconds: number;
  /** When set, client must send the same Content-Type header on PUT. */
  contentType?: string;
  /** Virtual-hosted (default) or path-style (custom endpoint). */
  usePathStyle: boolean;
  /** e.g. localhost:4566 — no scheme */
  endpointHost?: string;
  endpointUseHttp?: boolean;
  /** Fixed clock for tests */
  now?: Date;
};

/**
 * Returns a presigned PUT URL for S3 SigV4 query-string auth.
 */
export async function presignS3PutUrl(p: PresignPutParams): Promise<string> {
  const d = p.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(d);
  const service = "s3";
  const credentialScope = `${dateStamp}/${p.region}/${service}/aws4_request`;
  const credential = `${p.accessKeyId}/${credentialScope}`;

  const host = p.usePathStyle
    ? (p.endpointHost ?? `s3.${p.region}.amazonaws.com`)
    : `${p.bucket}.s3.${p.region}.amazonaws.com`;

  const canonicalUri = p.usePathStyle
    ? `/${awsUriEncode(p.bucket, false)}/${p.objectKey.split("/").map((s) => awsUriEncode(s, false)).join("/")}`
    : canonicalUriForKey(p.objectKey);

  const signedHeaders = p.contentType
    ? "content-type;host;x-amz-content-sha256"
    : "host;x-amz-content-sha256";

  const baseParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(p.expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];

  const canonicalQueryString = sortEncodeQuery(baseParams);

  const canonicalHeaders = p.contentType
    ? `content-type:${p.contentType.trim()}\nhost:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\n`
    : `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\n`;

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signingKey = await getSigningKey(
    p.secretAccessKey,
    dateStamp,
    p.region,
    service,
  );
  const sigBuf = await hmacSha256(signingKey, stringToSign);
  const signature = toHex(sigBuf);

  const finalQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const scheme =
    p.usePathStyle && p.endpointUseHttp ? "http" : "https";
  return `${scheme}://${host}${canonicalUri}?${finalQuery}`;
}

export type PresignGetParams = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  objectKey: string;
  expiresSeconds: number;
  usePathStyle: boolean;
  endpointHost?: string;
  endpointUseHttp?: boolean;
  now?: Date;
  /** S3 GetObject 上書き: Content-Disposition（例 attachment; filename*=UTF-8''...） */
  responseContentDisposition?: string;
  /** S3 GetObject 上書き: Content-Type */
  responseContentType?: string;
};

/**
 * プリサイン GET（GetObject）。プライベート S3 の短 TTL ダウンロード／インライン表示用。
 * 署名方式は PUT プリサインと同じクエリ文字列 SigV4。
 */
export async function presignS3GetUrl(p: PresignGetParams): Promise<string> {
  const d = p.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(d);
  const service = "s3";
  const credentialScope = `${dateStamp}/${p.region}/${service}/aws4_request`;
  const credential = `${p.accessKeyId}/${credentialScope}`;

  const host = p.usePathStyle
    ? (p.endpointHost ?? `s3.${p.region}.amazonaws.com`)
    : `${p.bucket}.s3.${p.region}.amazonaws.com`;

  const canonicalUri = p.usePathStyle
    ? `/${awsUriEncode(p.bucket, false)}/${p.objectKey.split("/").map((s) => awsUriEncode(s, false)).join("/")}`
    : canonicalUriForKey(p.objectKey);

  const signedHeaders = "host;x-amz-content-sha256";

  const baseParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(p.expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  const extra: Array<[string, string]> = [];
  if (p.responseContentDisposition !== undefined && p.responseContentDisposition !== "") {
    extra.push(["response-content-disposition", p.responseContentDisposition]);
  }
  if (p.responseContentType !== undefined && p.responseContentType !== "") {
    extra.push(["response-content-type", p.responseContentType]);
  }
  const canonicalQueryString = sortEncodeQuery([...baseParams, ...extra]);

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\n`;

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signingKey = await getSigningKey(
    p.secretAccessKey,
    dateStamp,
    p.region,
    service,
  );
  const sigBuf = await hmacSha256(signingKey, stringToSign);
  const signature = toHex(sigBuf);

  const finalQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const scheme =
    p.usePathStyle && p.endpointUseHttp ? "http" : "https";
  return `${scheme}://${host}${canonicalUri}?${finalQuery}`;
}

export type PresignUploadPartParams = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  objectKey: string;
  expiresSeconds: number;
  uploadId: string;
  partNumber: number;
  usePathStyle: boolean;
  endpointHost?: string;
  endpointUseHttp?: boolean;
  now?: Date;
};

export async function presignS3UploadPartUrl(
  p: PresignUploadPartParams,
): Promise<string> {
  const d = p.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(d);
  const service = "s3";
  const credentialScope = `${dateStamp}/${p.region}/${service}/aws4_request`;
  const credential = `${p.accessKeyId}/${credentialScope}`;

  const host = p.usePathStyle
    ? (p.endpointHost ?? `s3.${p.region}.amazonaws.com`)
    : `${p.bucket}.s3.${p.region}.amazonaws.com`;

  const canonicalUri = p.usePathStyle
    ? `/${awsUriEncode(p.bucket, false)}/${p.objectKey.split("/").map((s) => awsUriEncode(s, false)).join("/")}`
    : canonicalUriForKey(p.objectKey);

  const signedHeaders = "host;x-amz-content-sha256";

  const baseParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(p.expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
    ["partNumber", String(p.partNumber)],
    ["uploadId", p.uploadId],
  ];

  const canonicalQueryString = sortEncodeQuery(baseParams);

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\n`;

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signingKey = await getSigningKey(
    p.secretAccessKey,
    dateStamp,
    p.region,
    service,
  );
  const sigBuf = await hmacSha256(signingKey, stringToSign);
  const signature = toHex(sigBuf);

  const finalQuery = `${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const scheme =
    p.usePathStyle && p.endpointUseHttp ? "http" : "https";
  return `${scheme}://${host}${canonicalUri}?${finalQuery}`;
}

export type SignedFetchParams = {
  method: string;
  url: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  headers: Record<string, string>;
  body: ArrayBuffer | Uint8Array | string;
  now?: Date;
};

/** SigV4 Authorization header for arbitrary AWS request (small bodies only). */
export async function signAwsRequest4(
  p: SignedFetchParams,
): Promise<Headers> {
  const d = p.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(d);
  const url = new URL(p.url);
  const host = url.host;
  const canonicalUri = url.pathname || "/";
  const search = url.searchParams;
  const qp: Array<[string, string]> = [];
  search.forEach((v, k) => {
    qp.push([k, v]);
  });
  const canonicalQueryString = sortEncodeQuery(qp);

  const headerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(p.headers)) {
    headerMap.set(k.toLowerCase().trim(), v.trim());
  }
  headerMap.set("host", host);
  headerMap.set("x-amz-date", amzDate);

  let payloadHash: string;
  if (typeof p.body === "string") {
    payloadHash = await sha256Hex(p.body);
  } else if (p.body instanceof ArrayBuffer) {
    payloadHash = await sha256Hex(new Uint8Array(p.body));
  } else {
    payloadHash = await sha256Hex(p.body);
  }
  headerMap.set("x-amz-content-sha256", payloadHash);

  const sortedKeys = [...headerMap.keys()].sort();
  const canonicalHeaders = sortedKeys
    .map((k) => `${k}:${headerMap.get(k)}\n`)
    .join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [
    p.method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${p.region}/${p.service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signingKey = await getSigningKey(
    p.secretAccessKey,
    dateStamp,
    p.region,
    p.service,
  );
  const sigBuf = await hmacSha256(signingKey, stringToSign);
  const signature = toHex(sigBuf);

  const authorization = `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const out = new Headers();
  for (const [k, v] of headerMap) {
    out.set(k, v);
  }
  out.set("Authorization", authorization);
  return out;
}
