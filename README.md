# Firma

App web para firmar contratos (estilo Signaturit). Sube un PDF, dibuja un
recuadro de firma ajustable sobre cualquier página, firma con ratón o dedo y
descarga el documento con la firma incrustada.

## Uso

```bash
npm install
npm run dev
```

Abre la URL que indique Vite (normalmente http://localhost:5173).
Para probar desde el móvil en la misma red: `npm run dev -- --host`.

## Flujo

1. **Subir** un PDF (arrastrar o clic).
2. **Añadir campo de firma** → dibuja el recuadro sobre la página.
3. Se abre el **lienzo en blanco** → firma → la firma aparece en el recuadro.
   - El recuadro se puede **mover** (arrastrar), **redimensionar** (tirador
     inferior derecho) y **eliminar** (×).
   - Vuelve a hacer clic en un recuadro para **re-firmarlo**.
4. **Descargar firmado** → genera el PDF con la firma incrustada.

## Stack

- `pdfjs-dist` — renderizado del documento y sus páginas.
- `signature_pad` — lienzo de firma (ratón + táctil).
- `pdf-lib` — incrustación de la firma en el PDF.
- `vite` — servidor de desarrollo y build.

## Pendiente (siguientes fases)

- **DOCX**: requiere convertir a PDF antes de firmar (p. ej. LibreOffice en
  servidor). Hoy solo se aceptan PDF.
- Páginas con rotación (`/Rotate`) distinta de 0: el posicionamiento está
  calibrado para orientación vertical estándar.
- Firma remota: enviar enlace para firmar desde otro dispositivo.
- Detección automática de zonas de firma en el documento.
