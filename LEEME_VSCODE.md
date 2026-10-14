# Ejecutar el inventario en Visual Studio Code

## Requisitos

- Visual Studio Code.
- Node.js 24 LTS, que incluye npm. Puedes descargarlo en https://nodejs.org/.

## Abrir y ejecutar

1. Extrae este ZIP.
2. En VS Code, selecciona Archivo > Abrir carpeta y abre `appwebInnovacion`.
3. Abre Terminal > Nueva terminal. Debes estar en la carpeta que contiene `package.json`.
4. Instala exactamente las dependencias del archivo de bloqueo:

   npm ci

5. Inicia la aplicación:

   npm run dev

6. Abre en tu navegador la dirección que aparece en la terminal de Vite.

Deja abierta esa terminal mientras uses la aplicación. Para detenerla, pulsa Ctrl+C.
No necesitas instalar dependencias globales de React ni de Vite.

Si PowerShell en Windows bloquea npm.ps1, selecciona una terminal de tipo Command Prompt (CMD) en VS Code, o usa `npm.cmd ci` y `npm.cmd run dev`.

## Comprobaciones opcionales

   npm run lint -- --max-warnings=0
   npm run build
   npm run preview

`build` genera la carpeta `dist`; `preview` permite revisar ese resultado localmente. No es un servidor de producción.

## Funciones incluidas

- Añadir y editar productos, categorías, códigos SKU, existencias y precios.
- Buscar por nombre, código o categoría y filtrar por categoría.
- Detectar stock bajo y consultar el valor del inventario.
- Eliminar productos con confirmación.
- Guardar datos al recargar mediante el almacenamiento local del navegador.
- Interfaz adaptable a escritorio y móvil.

Los precios se muestran en pesos colombianos (COP). Los datos se guardan solo en este navegador y en la misma dirección de la aplicación; no se sincronizan entre equipos ni navegadores. Borrar el almacenamiento del sitio también borra los productos. Esta versión no incluye backend ni autenticación.

El ZIP incluye todos los archivos fuente y el package-lock.json original. Las carpetas `node_modules`, `dist`, `.git` y los archivos del entorno en la nube no se incluyen; `npm ci` genera las dependencias necesarias en tu equipo.
