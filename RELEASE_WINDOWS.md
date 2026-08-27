# PublicaciÃ³n segura de LogYourTime para Windows

## PreparaciÃ³n inicial

Configura en GitHub Actions estos secretos:

- `WINDOWS_CERTIFICATE_BASE64`: certificado de firma de cÃ³digo PFX codificado en Base64.
- `WINDOWS_CERTIFICATE_PASSWORD`: contraseÃ±a del certificado.

El workflow rechaza una publicaciÃ³n sin firma. El permiso `contents: write` y el
`GITHUB_TOKEN` de Actions se utilizan exclusivamente para crear el release.

## Publicar

1. Incrementa `version` en `package.json`.
2. Ejecuta `npm test` y `npm run dist:win` localmente.
3. Ejecuta `npm run release:verify`; debe encontrar instalador, blockmap y `latest.yml`.
4. Crea y sube un tag con el mismo nÃºmero: `v1.2.0` para la versiÃ³n `1.2.0`.
5. GitHub Actions compila, firma, valida y publica los tres artefactos juntos.
6. Confirma en el release que existen `latest.yml`, el `.exe` y su `.blockmap`.

Nunca publiques solamente el instalador: los clientes mostrarÃ¡n una actualizaciÃ³n
incompleta si falta cualquiera de esos archivos.

## RecuperaciÃ³n y rollback

La aplicaciÃ³n conserva la versiÃ³n instalada cuando el instalador nuevo falla. Tras
una instalaciÃ³n correcta, la versión nueva debe permanecer abierta 45 segundos para
marcarse saludable. Si se reinicia antes, pausa nuevas actualizaciones y registra el
incidente en los logs.

Para revertir una versiÃ³n ya distribuida, no reemplaces artefactos de un release:

1. Recupera el commit estable anterior.
2. Incrementa el parche (por ejemplo, de `1.2.0` a `1.2.1`).
3. Publica ese cÃ³digo mediante el workflow normal.
4. Verifica la firma y los tres artefactos antes de anunciar la recuperaciÃ³n.

Este procedimiento mantiene una historia auditable y permite que todos los clientes
reciban la reversiÃ³n como una actualización válida y firmada.
