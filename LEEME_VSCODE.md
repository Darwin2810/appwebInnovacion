# Abrir y actualizar EXLAIDER en Windows

## 1. Abre la carpeta correcta

Descarga el ZIP de la rama `exlaider-erp`, extráelo y en VS Code selecciona **Archivo → Abrir carpeta**. Abre la carpeta interior que contiene `package.json`, `src` y `functions`.

Si estás actualizando, conserva la carpeta anterior completa y su `.env.local`. Trabaja con la nueva entrega en otra carpeta. Copia únicamente tu `.env.local` a la carpeta nueva; no necesitas copiar `node_modules` ni `dist`. Las cuentas y el inventario siguen en el proyecto Firebase, no dentro del ZIP.

## 2. Instala las dependencias

Instala Node.js 22 LTS y vuelve a abrir VS Code. Node24 también permite desarrollar. En **Terminal → Nueva terminal**, PowerShell:

```powershell
node --version
npm.cmd --version
Get-Location
Get-ChildItem -Name
npm.cmd ci
npm.cmd ci --prefix functions
```

Si sólo aparece otra carpeta con el mismo nombre, entra a esa carpeta primero. El ZIP incluye ambos `package-lock.json`: `npm ci` debe ejecutarse donde está `package.json`. `npm.cmd` evita el bloqueo de `npm.ps1` sin cambiar la política de Windows.

## 3. Conserva o crea la configuración

Si ya tenías `.env.local`, úsalo. En una instalación nueva:

```powershell
Copy-Item .env.example .env.local
```

Completa sus cuatro valores de Firebase y conserva `VITE_FIREBASE_COMPANY_ID=exlaider-jeans`. La región de Functions es `us-east1`. No pongas claves privadas ni cuentas de servicio en variables `VITE_`.

## 4. Elige prueba local o nube

**Prueba local sin facturación:** instala Java21. En una terminal ejecuta `npm.cmd run emulators` y en otra `npm.cmd run dev:emulator`. Crea una cuenta desde la página y autoriza su UID con:

```powershell
node scripts/approve-emulator.mjs TU_UID admin
```

Los emuladores son temporales; `demo-inventario` no envía operaciones a tu empresa real.

**Nube:** esta versión utiliza Firebase Functions para proteger y validar las operaciones, y requiere **Blaze**. Si tu proyecto sigue en Spark, conserva la versión publicada mientras pruebas ésta con emuladores. Cambiar el plan y publicar son pasos distintos de descargar o probar el código.

Cuando tu proyecto tenga Functions disponible y hayas revisado la migración de [docs/ERP.md](docs/ERP.md):

```powershell
npm.cmd run firebase -- login
npm.cmd run lint -- --max-warnings=0
npm.cmd test
npm.cmd run build
npm.cmd run firebase -- deploy --project exlaider-inventario --only functions
npm.cmd run firebase -- deploy --project exlaider-inventario --only "firestore,hosting"
```

**Usa tu ID de proyecto** si es distinto de `exlaider-inventario`. Antes del último comando, comprueba que `.env.local` apunta al mismo proyecto. Programa una ventana de actualización: al publicar las reglas nuevas, la interfaz anterior ya no podrá escribir directamente en Firestore. Publica la nueva interfaz y las reglas en esa misma ventana. Esta entrega no se ha desplegado en tu sitio automáticamente.

## 5. Entra y migra el inventario

Usa tu cuenta administradora existente. En Inventario aparece una sección para los productos anteriores. Pulsa **Revisar y migrar inventario**, corrige las referencias y confirma con **Migrar productos seleccionados**, hasta 20 por operación. El backend conserva los documentos anteriores y los IDs usados por los QR; no borra stock ni duplica una migración ya confirmada. Los costos anteriores desconocidos quedan pendientes: registra el costo real con **Valorar existencias** o con compras nuevas, sin usar el precio de venta como costo.

Autoriza cuentas creadas en Authentication desde **Usuarios** con su UID exacto y rol `admin`, `operator` o `viewer`. El primer administrador conserva su documento `organizations/exlaider-jeans/members/UID`, con `active` booleano `true` y `role` texto `admin`.

## 6. Computador y celular

Abre `https://exlaider-inventario.web.app/` después de publicar. Ambos dispositivos usan el mismo proyecto, empresa y cuentas autorizadas; no necesitan estar en la misma red. En iPhone abre en Safari y permite la cámara para ese sitio. HTTPS es necesario para cámara. Puedes añadir la página a la pantalla de inicio. La cámara física se debe probar en tu teléfono; el código incluye selección de cámara y alternativa **Leer imagen QR**.

Para ver únicamente la interfaz desde la red local:

```powershell
npm.cmd run dev -- --host 0.0.0.0
```

La dirección HTTP de la red local no habilita la cámara en iPhone; usa el sitio HTTPS para escanear. Las operaciones se deshabilitan sin conexión y sólo se confirman cuando responde el servidor.

## 7. Comprobaciones

```powershell
npm.cmd run test:cloud
npm.cmd run build -- --mode emulator
npm.cmd run test:browser
```

Requieren Java21 y Chrome/Chromium. `npm.cmd run build` vuelve a crear la compilación de producción cuando termines de probar. Consulta los errores comunes y el contenido del QR en [docs/FIREBASE_Y_QR.md](docs/FIREBASE_Y_QR.md).
