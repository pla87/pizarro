// Etiquetas de los destinos de copia en Administración → Copias de seguridad: el host S3 sale recortado.
import assert from "node:assert/strict";
import { test } from "node:test";
import { maskDestinationLabel, maskHost, maskHostIn, maskHostsIn } from "../src/lib/backup-label";

test("maskHost: recorta la primera parte (el id de cuenta de R2); IP, localhost y dominios de dos partes, igual", () => {
  assert.equal(maskHost("0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"), "…r2.cloudflarestorage.com");
  assert.equal(maskHost("s3.eu-west-1.amazonaws.com"), "…eu-west-1.amazonaws.com");
  assert.equal(maskHost("minio.example.com:9000"), "…example.com:9000");
  assert.equal(maskHost("localhost:9000"), "localhost:9000");
  assert.equal(maskHost("192.168.1.10:9000"), "192.168.1.10:9000");
  assert.equal(maskHost("example.com"), "example.com");
});

test("maskDestinationLabel y maskHostIn: solo el host; bucket, prefijo y carpetas se ven", () => {
  const label = "S3 abcd1234.r2.cloudflarestorage.com/copias/pizarro";
  assert.equal(maskDestinationLabel(label), "S3 …r2.cloudflarestorage.com/copias/pizarro");
  assert.equal(maskDestinationLabel("/mnt/copias"), "/mnt/copias");
  assert.equal(maskHostIn("getaddrinfo ENOTFOUND abcd1234.r2.cloudflarestorage.com", label), "getaddrinfo ENOTFOUND …r2.cloudflarestorage.com");
  assert.equal(maskHostIn("sin host", "/mnt/copias"), "sin host");
});

test("maskHostsIn: el error de una tarea programada, con el host de cualquiera de los destinos", () => {
  const labels = ["/mnt/copias", "S3 abcd1234.r2.cloudflarestorage.com/copias", "S3 s3.eu-west-1.example.com:9000/b"];
  const err = "copia externa: connect ECONNREFUSED s3.eu-west-1.example.com:9000; abcd1234.r2.cloudflarestorage.com: 403";
  assert.equal(maskHostsIn(err, labels), "copia externa: connect ECONNREFUSED …eu-west-1.example.com:9000; …r2.cloudflarestorage.com: 403");
  assert.equal(maskHostsIn("sin host", []), "sin host");
});
