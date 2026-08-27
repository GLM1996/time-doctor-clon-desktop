# Extensión LogYourTime para Chrome y Edge

La extensión comunica exclusivamente el dominio de la pestaña activa a la aplicación de escritorio mediante `127.0.0.1`. No envía rutas, parámetros, búsquedas, contenido ni historial.

## Prueba local

1. Inicia LogYourTime Desktop.
2. Abre `chrome://extensions` o `edge://extensions`.
3. Activa **Modo de desarrollador**.
4. Selecciona **Cargar descomprimida**.
5. Elige esta carpeta `browser-extension`.
6. Inicia el temporizador y navega entre varios dominios.

El identificador estable de la extensión es `pgpgcfgllapfcdggdjkmhiongaddjgdp`.

## Distribución

Para instalación automática debe publicarse esta misma carpeta en Chrome Web Store y Microsoft Edge Add-ons conservando la clave del manifiesto. El instalador de escritorio incluye una copia en `resources/browser-extension` para pruebas y despliegues administrados.
