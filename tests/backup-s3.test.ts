import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalQuery, EMPTY_SHA256, parseS3Env, sha256Hex, signingKey, signRequest, uriEncode } from "../src/lib/backup-s3";

// Vectores de prueba publicados por AWS (documentación de Signature V4 y de la API de S3).

test("SigV4: clave de firma derivada (ejemplo de la documentación de AWS)", () => {
  const key = signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam");
  assert.equal(key.toString("hex"), "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
});

test("SigV4: suite de AWS, get-vanilla", () => {
  const { authorization } = signRequest(
    { method: "GET", path: "/", query: [], headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" }, payloadHash: EMPTY_SHA256 },
    { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "service" },
  );
  assert.equal(authorization, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
});

const s3cred = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "s3" };

test("SigV4 S3: GET Object con Range", () => {
  const { signature } = signRequest(
    {
      method: "GET",
      path: "/test.txt",
      query: [],
      headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9", "x-amz-content-sha256": EMPTY_SHA256, "x-amz-date": "20130524T000000Z" },
      payloadHash: EMPTY_SHA256,
    },
    s3cred,
  );
  assert.equal(signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
});

test("SigV4 S3: PUT Object con carácter que se codifica ($)", () => {
  const body = "Welcome to Amazon S3.";
  assert.equal(sha256Hex(body), "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
  const { signature } = signRequest(
    {
      method: "PUT",
      path: `/${uriEncode("test$file.text", true)}`,
      query: [],
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-date": "20130524T000000Z",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
        "x-amz-content-sha256": sha256Hex(body),
      },
      payloadHash: sha256Hex(body),
    },
    s3cred,
  );
  assert.equal(signature, "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
});

test("SigV4 S3: listado con query ordenada", () => {
  const { signature } = signRequest(
    { method: "GET", path: "/", query: [["prefix", "J"], ["max-keys", "2"]], headers: { host: "examplebucket.s3.amazonaws.com", "x-amz-content-sha256": EMPTY_SHA256, "x-amz-date": "20130524T000000Z" }, payloadHash: EMPTY_SHA256 },
    s3cred,
  );
  assert.equal(signature, "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
});

test("codificación URI y query canónica", () => {
  assert.equal(uriEncode("a b/ñ~*", true), "a%20b/%C3%B1~%2A");
  assert.equal(uriEncode("a/b"), "a%2Fb");
  assert.equal(canonicalQuery([["b", "2"], ["a", "x y"], ["list-type", "2"]]), "a=x%20y&b=2&list-type=2");
});

test("BACKUP_S3_*: sin variables no hay S3; a medias es un error sin secretos", () => {
  assert.deepEqual(parseS3Env({}), { config: null, error: null });
  const half = parseS3Env({ BACKUP_S3_ENDPOINT: "https://x.r2.cloudflarestorage.com", BACKUP_S3_SECRET_ACCESS_KEY: "supersecreto" });
  assert.equal(half.config, null);
  assert.match(half.error!, /BACKUP_S3_BUCKET/);
  assert.ok(!half.error!.includes("supersecreto"));
  const ok = parseS3Env({ BACKUP_S3_ENDPOINT: "https://x.example.com/", BACKUP_S3_BUCKET: "b", BACKUP_S3_ACCESS_KEY_ID: "id", BACKUP_S3_SECRET_ACCESS_KEY: "s", BACKUP_S3_PREFIX: "/pizarro" });
  assert.equal(ok.config?.region, "auto");
  assert.equal(ok.config?.prefix, "pizarro/");
  assert.equal(ok.config?.endpoint, "https://x.example.com");
  assert.match(parseS3Env({ BACKUP_S3_ENDPOINT: "ftp://x", BACKUP_S3_BUCKET: "b", BACKUP_S3_ACCESS_KEY_ID: "i", BACKUP_S3_SECRET_ACCESS_KEY: "s" }).error!, /https/);
});
