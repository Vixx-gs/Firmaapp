// Almacenamiento de PDFs en OVHCloud Object Storage (compatible con S3).
// Si las variables S3_* no están configuradas, las funciones lanzan error.
// El código que las llama debe comprobar isS3Enabled() primero.

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

let client = null;

function getClient() {
  if (client) return client;
  const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) return null;
  client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION || 'eu-west-par',
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    forcePathStyle: true, // OVHCloud requiere path-style (bucket en la ruta, no en el host)
  });
  return client;
}

export function isS3Enabled() {
  return Boolean(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
}

function bucket() {
  return process.env.S3_BUCKET || 'documentos-firmados';
}

/** Clave S3 para un documento dado su ID. */
export function pdfKey(documentId) {
  return `${documentId}.pdf`;
}

/** Sube (o sobreescribe) un PDF en S3. */
export async function uploadPdf(key, buffer) {
  const s3 = getClient();
  if (!s3) throw new Error('S3 no configurado: faltan S3_ENDPOINT, S3_ACCESS_KEY o S3_SECRET_KEY.');
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
    })
  );
}

/** Descarga un PDF de S3 y devuelve un Buffer. */
export async function downloadPdf(key) {
  const s3 = getClient();
  if (!s3) throw new Error('S3 no configurado.');
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return Buffer.from(await res.Body.transformToByteArray());
}

/** Comprueba si un objeto existe en S3 sin descargarlo. Devuelve true/false. */
export async function pdfExists(key) {
  const s3 = getClient();
  if (!s3) return true; // sin S3, asumimos que existe en BD
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}
