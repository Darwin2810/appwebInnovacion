# Firebase, acceso, tiempo real y QR · versión 2.1

Esta entrega usa React/Vite, Authentication, Firestore y **Functions**. Las lecturas son en tiempo real; las operaciones de negocio sólo se escriben en el backend. La versión anterior escribía desde el navegador: esas funciones se sustituyen por `src/lib/erpApi.js` y las reglas nuevas deniegan escrituras directas.

## Configurar el proyecto

1. En [Firebase Console](https://console.firebase.google.com/) selecciona tu proyecto (el existente de EXLAIDER es `exlaider-inventario`). Registra una aplicación **Web** si todavía no existe.
2. En **Configuración del proyecto → Tus apps → Configuración del SDK**, copia `apiKey`, `authDomain`, `projectId` y `appId` a los valores correspondientes de `.env.local` desde `.env.example`. La configuración web es pública; las claves privadas de Admin SDK nunca van en la aplicación.
3. En **Compilación → Authentication → Comenzar → Método de acceso**, habilita **Correo electrónico/contraseña**.
4. En **Firestore Database → Crear base de datos**, usa edición Standard, ID `(default)` y modo producción. Selecciona la región antes de crear: no se cambia con este código.
5. Las Functions se publican en `us-east1` y requieren plan **Blaze** con facturación. Probar localmente con emuladores no lo requiere. No se activa ni se modifica tu plan al instalar estas dependencias.

```dotenv
VITE_FIREBASE_API_KEY=TU_API_KEY_WEB
VITE_FIREBASE_AUTH_DOMAIN=TU_PROYECTO.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=TU_PROYECTO
VITE_FIREBASE_APP_ID=TU_APP_ID_WEB
VITE_FIREBASE_COMPANY_ID=exlaider-jeans
VITE_FIREBASE_FUNCTIONS_REGION=us-east1
```

No reemplaces un `.env.local` existente al actualizar. Reinicia Vite después de editarlo. Comprueba sus valores **antes** de compilar/publicar.

## Primer administrador y aprobación

En Authentication crea o identifica una cuenta y copia su UID exacto. En Firestore crea:

```text
organizations/exlaider-jeans
  name: "EXLAIDER JEANS SAS"
organizations/exlaider-jeans/members/UID_EXACTO
  active: true       (tipo booleano)
  role: "admin"      (tipo texto)
```

No escribas `employee`: los roles válidos son `admin`, `operator`, `seller` y `viewer`, mostrados como Administrador, Operador, Vendedor y Usuario. El UID debe ser el mostrado al iniciar sesión en la aplicación, respetando mayúsculas. Conserva estos documentos si ya existen. El primer administrador se crea en Console porque el registro público nunca se concede permisos por sí solo. Después, **Usuarios** permite autorizar, cambiar rol o desactivar otras cuentas existentes en Authentication. No puedes quitar tu propio acceso de administrador desde esa sesión.

Si se muestra acceso pendiente, verifica proyecto, empresa, UID y los dos campos. La membresía se escucha en tiempo real: activar/desactivar o cambiar rol actualiza la interfaz; los permisos también se vuelven a verificar dentro de cada operación del servidor.

## Instalación y publicación

Desde la carpeta con `package.json`, PowerShell:

```powershell
npm.cmd ci
npm.cmd ci --prefix functions
npm.cmd run firebase -- login
npm.cmd run lint -- --max-warnings=0
npm.cmd test
npm.cmd run build
```

Antes de sustituir una versión existente lee [ERP.md](ERP.md), conserva una copia del código/configuración y prepara el respaldo de tus datos. En una ventana de actualización, con Blaze disponible:

```powershell
npm.cmd run firebase -- deploy --project exlaider-inventario --only functions
npm.cmd run firebase -- deploy --project exlaider-inventario --only "firestore,hosting"
```

Sustituye el ID si usas otro proyecto. Las reglas nuevas impiden escribir desde la versión anterior: publica reglas e interfaz nueva durante la misma ventana. No ejecutes `firebase init` sobre esta entrega: ya contiene `firebase.json`, reglas y Functions. La aplicación publicada es HTTPS y permite acceder desde celular sin servidor Vite encendido.

## Tiempo real y permisos

`src/hooks/useOrgData.js` escucha referencias/variantes con `onSnapshot`. Los módulos privados son exclusivos de `admin`; el vendedor recibe únicamente su proyección de ventas `salesDesk` y el operador sus propios movimientos. Al cambiar UID o rol descarta los datos de la sesión anterior y cancela sus escuchas. El operador no solicita costos, finanzas ni personal. Vendedor y usuario consultan sólo productos terminados (filtro `kind == finished`). `src/hooks/useAuth.js` escucha la aprobación y revocación de la cuenta. Consulta la [matriz de permisos](PERMISOS_Y_CATALOGO.md).

El cliente envía `{companyId,action,requestId,payload}` a la callable `erp`. El servidor obtiene el UID del token de Authentication, verifica membresía dentro de la transacción, valida datos y escribe el documento de negocio, stock/costos, movimientos, asientos y auditoría. La misma solicitud repetida devuelve el resultado anterior sin repetir stock o pagos; reutilizar el ID con datos diferentes se rechaza.

No se permiten escrituras de negocio desde el SDK del navegador, tampoco al administrador: éste tiene todas las operaciones mediante el backend, con validaciones e historial. No se puede vender sin stock ni borrar asientos ya registrados para ocultar una operación.

## Preparar QR antes de guardar

1. Como administrador, en **Inventario → Añadir producto**, completa nombre, referencia, SKU, precio, stock inicial, talla, color, lote y demás campos.
2. Pulsa **Generar QR sin guardar**. Revisa el QR y descarga su PNG. No se crea ningún documento en Firestore.
3. En otro dispositivo pulsa **Escanear QR**, permite cámara o usa **Leer imagen QR** con el PNG.
4. Si el SKU no existe, el administrador revisa el formulario y pulsa **Guardar producto**. El operador recibe un aviso para solicitar su creación; no puede crear referencias ni variantes desde QR.
5. Si ya existe, administrador y operador pueden abrir el ingreso de stock; la opción de ingreso directo suma una unidad. Los demás roles sólo consultan. No sobrescribe el precio, nombre ni stock actual con una etiqueta antigua.

En **Varias tallas y colores** puedes preparar un QR por cada fila antes de guardar todas. Cada variante tiene SKU, talla/color/lote y stock propios. El nombre y la referencia son comunes. Los QR no contienen costos privados, roles, datos personales ni instrucciones de pago.

Ejemplo del contenido (los importes del QR son COP, no centavos; la API los convierte al modelo entero):

```json
{
  "v": 1,
  "type": "inventory-product",
  "name": "Jeans Slim",
  "sku": "EX-100-AZ-32",
  "reference": "EX-100",
  "category": "Jeans",
  "description": "Denim azul",
  "size": "32",
  "color": "Azul",
  "lot": "L-01",
  "price": 85000,
  "stock": 12,
  "minStock": 3,
  "imageUrl": "",
  "currency": "COP",
  "kind": "finished",
  "unit": "unidad"
}
```

Los QR antiguos sin `kind`/`unit` se interpretan como producto terminado/unidad. Se acepta también un SKU simple. El lector rechaza URLs, campos desconocidos, versiones no admitidas y datos inválidos; nunca abre enlaces externos. Busca sólo dentro de la empresa activa. Los IDs de productos antiguos se conservan al migrar.

Si todos los campos exceden la capacidad del QR, un borrador solicita acortar la descripción: no lo sustituye silenciosamente por un código incompleto. Para un producto ya guardado se permite un QR compacto con ID/SKU, consultando sus datos actuales en la nube.

## Cámara en iPhone y otros dispositivos

Abre el sitio **HTTPS** directamente en Safari o el navegador principal; evita navegadores dentro de redes sociales. Permite la cámara para el sitio en los controles del navegador. Si la denegaste, cambia el permiso y vuelve a abrir el lector. Selecciona la cámara trasera; otra aplicación puede tenerla ocupada.

El lector incluye vídeo inline, selección de cámaras y detención al cerrar. Enumera dispositivos sin abrir una segunda transmisión que pueda interrumpir el vídeo en iOS. **Leer imagen QR** permite escanear una foto/PNG como alternativa; si ZXing no detecta una matriz densa válida, un segundo decodificador de píxeles la comprueba sin abrir enlaces. Las pruebas de navegador no sustituyen la validación con un iPhone físico. `http://192.168...` no es un contexto seguro para cámara; `localhost` sólo funciona en el propio dispositivo.

## Emuladores y verificación

Instala Java21 y las dependencias de las dos carpetas. Dos terminales:

```powershell
npm.cmd run emulators
```

```powershell
npm.cmd run dev:emulator
```

El modo emulador fija `demo-inventario`; usa Auth9099, Firestore8080 y Functions5001 en127.0.0.1. Crea una cuenta local en la página y ejecuta `node scripts/approve-emulator.mjs UID admin`. No uses usuarios/contraseñas reales para pruebas. Los datos locales son temporales.

```powershell
npm.cmd run lint -- --max-warnings=0
npm.cmd test
npm.cmd run test:cloud
npm.cmd run build -- --mode emulator
npm.cmd run test:browser
npm.cmd run build
```

Prueba además en el proyecto real: administrador en dos dispositivos, crear variante móvil→PC, los cuatro roles, ingreso QR del operador, venta/pago del vendedor y anulación administrativa. Comprueba archivo, papelera y trazabilidad con datos de prueba identificables. Aquí no se han usado credenciales de producción ni se ha publicado automáticamente esta versión.

## Problemas frecuentes

| Mensaje | Acción |
|---|---|
| npm no reconocido | Instala Node y vuelve a abrir VS Code. |
| npm.ps1 bloqueado | Usa `npm.cmd`. |
| npm ci EUSAGE | Entra a la carpeta interior con `package.json` y `package-lock.json`. El ZIP incluye ambos. |
| Acceso pendiente | Comprueba el UID exacto, proyecto/empresa, active booleano y rol válido. |
| Permisos Firestore | Publica las reglas de esta versión y verifica la membresía. No habilites lecturas/escrituras públicas. |
| Functions no disponible / internal | Comprueba publicación de `erp`, región us-east1, plan y registros de Functions. No repitas pagos sin revisar historial. |
| Referencia con nombre distinto | Añade la variante al nombre existente o usa otra referencia; un administrador puede corregir el nombre común. |
| Inventario anterior sólo lectura | El administrador debe revisar y migrar esos productos. |
| Java/emulador no arranca | Instala Java21 y permite descargar el JAR oficial de Firestore; CI realiza las mismas pruebas. |
