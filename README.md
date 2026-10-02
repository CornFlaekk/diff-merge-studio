# Entre líneas

Aplicación estática en español para comparar dos textos, revisar diferencias por bloques, escoger qué versión conservar en cada cambio y descargar el resultado junto con notas de revisión.

## Privacidad

- La comparación, las decisiones y las notas se procesan en el navegador; el código de la app no envía el contenido a un servidor ni lo guarda en almacenamiento persistente.
- Los archivos se leen localmente. La aplicación rechaza archivos mayores de 2 MB cada uno, textos pegados que superen 4 MB en conjunto, contenido con bytes NUL y archivos que no sean UTF-8 válido.
- Las descargas se crean localmente. No se necesitan cuentas, API ni servicios externos.
- No se hacen solicitudes a terceros: también se usan tipografías del sistema, sin Google Fonts.

## Desarrollo y pruebas

Requiere Node.js 20 o posterior y npm.

```sh
npm ci
npm test
npm run dev
```

Crear y previsualizar el paquete de producción:

```sh
npm run build
npm run preview
```

La biblioteca `diff` (jsdiff) realiza la comparación de líneas y Vite empaqueta sus dependencias en los archivos estáticos: no se necesita una CDN de JavaScript en tiempo de ejecución.

## Publicación en GitHub Pages

El sitio estático se sirve desde la carpeta `/docs` de la rama `main`; el build de Vite genera ahí los archivos listos para publicar.

1. Ejecuta `npm ci`, `npm test` y `npm run build`.
2. En el repositorio, abre **Settings → Pages** y selecciona **Deploy from a branch**, rama `main`, carpeta `/docs`.
3. Confirma que GitHub Pages queda habilitado. La URL será `https://CornFlaekk.github.io/diff-merge-studio/`.

Para actualizar el sitio, compila de nuevo y confirma en Git los cambios de código y de `docs/`. El despliegue no necesita un workflow de Actions.

## Supuestos

- “Texto” significa UTF-8; archivos binarios y codificaciones distintas de UTF-8 se rechazan en vez de interpretarse.
- Cada bloque contiguo de líneas diferentes es una decisión independiente. Las líneas idénticas que separan bloques se conservan automáticamente.
- Un cambio que no se ha resuelto se omite de la vista previa combinada; la descarga final permanece deshabilitada hasta resolver todos los cambios.
- Las notas son optativas, existen solo mientras la pestaña está abierta y se exportan por separado como Markdown.
- No hay almacenamiento local/sesión, telemetría, analítica ni sincronización.
- La aplicación estática no realiza solicitudes de red desde el navegador; sus recursos y dependencias están empaquetados localmente.

## Próximas mejoras

- Navegación entre cambios y atajos de teclado para aceptar original/nueva.
- Vista de contexto configurable y comparación más precisa de espacios en blanco.
- Exportación conjunta del texto combinado y las notas en un paquete descargable.
- Pruebas de interfaz en navegador y auditoría automatizada de accesibilidad.
