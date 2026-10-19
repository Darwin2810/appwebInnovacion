# Abrir EXLAIDER en Visual Studio Code

## 1. Preparar el computador

1. Instala [VS Code](https://code.visualstudio.com/) y [Node.js 24 LTS](https://nodejs.org/). Conserva la opción **Add to PATH** del instalador.
2. Cierra todas las ventanas de VS Code y vuelve a abrirlo para que detecte Node.js.
3. Extrae el proyecto y elige **Archivo → Abrir carpeta**. Abre la carpeta que contiene `package.json`.
4. Abre **Terminal → Nueva terminal**.

Comprueba:

```powershell
node --version
npm.cmd --version
```

La primera versión debe comenzar por `v24`. Si no reconoce un comando, revisa la instalación y vuelve a abrir VS Code. `npm.cmd` evita el bloqueo de scripts de PowerShell; no necesitas cambiar la política de ejecución.

## 2. Instalar

Desde la carpeta principal del proyecto:

```powershell
npm.cmd ci
```

No necesitas instalar React o Vite globalmente.

## 3. Preparar Firebase

Sigue [docs/FIREBASE_Y_QR.md](docs/FIREBASE_Y_QR.md): crea el proyecto, habilita correo/contraseña y Firestore, agrega los usuarios y sus documentos de miembro y publica las reglas **antes de usar datos reales**.

```powershell
Copy-Item .env.example .env.local
```

Abre `.env.local`, completa los valores de tu aplicación web Firebase y conserva `VITE_FIREBASE_COMPANY_ID=exlaider-jeans`. No compartas `.env.local` ni agregues claves de cuenta de servicio.

## 4. Iniciar

```powershell
npm.cmd run dev
```

Abre la dirección **Local** que aparece. Inicia sesión con una cuenta de Firebase Authentication autorizada en `organizations/exlaider-jeans/members/{UID}`. Registrarse no concede acceso ni permisos de administrador.

Mantén la terminal abierta. Para detener Vite pulsa **Ctrl+C**. Si cambias `.env.local`, reinicia Vite.

## 5. Verla en el celular

Para revisar la interfaz en la misma red Wi-Fi:

```powershell
npm.cmd run dev -- --host 0.0.0.0
```

Abre la dirección **Network** desde el navegador del celular. Si Windows solicita acceso, permite la red privada. Para usar la cámara móvil utiliza la URL **HTTPS** que obtendrás al [publicar en Firebase Hosting](docs/FIREBASE_Y_QR.md#publicar-con-https).

En Android, Chrome puede ofrecer **Instalar aplicación** o **Añadir a pantalla de inicio**. En iPhone abre la URL HTTPS en Safari y elige **Compartir → Añadir a pantalla de inicio**. Ambos equipos comparten productos si usan el mismo proyecto Firebase y empresa con cuentas autorizadas.

## 6. Registrar y escanear

1. Registra una prenda con referencia, talla, color, lote y un SKU único.
2. Genera su QR.
3. En el celular abre el lector y permite la cámara, carga una imagen o pega el contenido.
4. Revisa el producto detectado y confirma la cantidad. Si habilitas «Ingreso directo», cada lectura de un producto existente suma una unidad.
5. Comprueba que el computador recibe el producto o stock actualizado sin recargar.

Los usuarios con rol `viewer` consultan sin modificar.

## Desarrollo con emuladores

Instala Java 21 y comprueba `java -version`. En la primera terminal:

```powershell
npm.cmd run emulators
```

En otra terminal:

```powershell
npm.cmd run dev:emulator
```

Regístrate desde la aplicación local y copia el UID que aparece en «Acceso pendiente de aprobación». En otra terminal ejecuta `node scripts/approve-emulator.mjs TU_UID admin`. El helper solo autoriza miembros en el emulador local `demo-inventario`, nunca en producción. Los detalles están en [la guía](docs/FIREBASE_Y_QR.md#emuladores-locales). No uses contraseñas reales para desarrollo.

## Comprobaciones

```powershell
npm.cmd run lint -- --max-warnings=0
npm.cmd test
npm.cmd run test:cloud
npm.cmd run build
```

`test:cloud` requiere Java 21. Para revisar `dist`, ejecuta `npm.cmd run preview`. `node_modules` se instala con `npm.cmd ci`; no viene incluido en el código.

## Problemas frecuentes

| Problema | Acción |
| --- | --- |
| `npm` no se reconoce | Instala Node.js y abre de nuevo todas las ventanas de VS Code. |
| `npm.ps1` bloqueado | Usa `npm.cmd`. |
| Configuración Firebase incompleta | Completa `.env.local` y reinicia Vite. |
| Cuenta sin acceso | Autoriza su UID como miembro activo de la empresa. |
| `permission-denied` | Revisa proyecto, empresa, rol, membresía y publicación de reglas. |
| Cámara no disponible | Abre HTTPS, concede permiso y cierra otras aplicaciones que usen la cámara. Usa una imagen como alternativa. |
| No llega un cambio | Revisa conexión, mismo proyecto/empresa y los errores mostrados. |
| Emulador falla por Java | Instala Java 21 y vuelve a abrir la terminal. |

El proyecto no incluye una cuenta Firebase ni un despliegue real ya configurados. La cámara debe verificarse físicamente con los dispositivos que usará la empresa.
