# Firebase y QR, paso a paso

Esta guía conecta el código a un proyecto Firebase propio y explica la cámara y el tiempo real. No se incluyen credenciales reales ni una base de producción ya creada. Los comandos son para PowerShell; en macOS/Linux utiliza `npm` en lugar de `npm.cmd`.

## 1. Instalar y crear el proyecto cloud

1. Instala Node.js 24 LTS y ejecuta `npm.cmd ci` desde la carpeta que contiene `package.json`.
2. Abre [Firebase Console](https://console.firebase.google.com/), crea un proyecto para EXLAIDER o selecciona uno que la empresa ya administre.
3. Agrega una **aplicación web** y copia su configuración. No hace falta agregar aplicaciones nativas de iOS o Android para esta PWA.
4. En **Authentication → Método de acceso**, habilita **Correo electrónico/contraseña**.
5. En **Firestore Database**, crea la base **`(default)`**, elige una región adecuada y comienza con reglas cerradas, sin habilitar escritura pública.
6. En **Authentication → Configuración → Dominios autorizados**, agrega `localhost` para desarrollo si no aparece. Al publicar, autoriza el dominio HTTPS que utilizarás.

La región de Firestore se debe decidir antes de usar datos reales. Revisa los límites y costos del plan con la empresa; no se necesita contratar un CRM externo para ejecutar este módulo.

## 2. Configurar las variables web

Copia la plantilla:

```powershell
Copy-Item .env.example .env.local
```

Completa `.env.local` con la configuración de la aplicación web en Firebase Console:

```dotenv
VITE_FIREBASE_API_KEY=valor-de-apiKey
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_APP_ID=valor-de-appId
VITE_FIREBASE_COMPANY_ID=exlaider-jeans
```

Estos valores identifican la aplicación web y llegan al navegador. La API key web de Firebase no sustituye permisos: la protección depende de Authentication y de `firestore.rules`. Nunca pongas una clave privada, JSON de cuenta de servicio, contraseña o token administrativo en variables `VITE_*`.

No guardes `.env.local` en Git ni lo incluyas en una distribución. Después de editarlo reinicia Vite. Para un build publicado las variables deben estar correctas **antes** de ejecutar `npm.cmd run build`.

## 3. Crear cuentas y aprobar miembros

Las identidades de Authentication y los permisos de la empresa son distintos. Para el primer administrador:

1. En **Authentication → Usuarios**, crea su cuenta con un correo que controle y una contraseña elegida por el responsable. También puede registrarse desde la interfaz, pero seguirá sin permisos hasta la aprobación.
2. Copia el **UID** de esa cuenta desde Authentication.
3. En Firestore crea `organizations/exlaider-jeans`. Si la consola pide datos del documento padre, puedes agregar `name: "EXLAIDER JEANS S.A.S."`.
4. Dentro crea la subcolección `members` y un documento cuyo ID sea exactamente ese UID.
5. Agrega los campos con sus tipos correctos:

```json
{
  "role": "admin",
  "active": true
}
```

`active` es booleano, no el texto `"true"`. Para operadores usa `role: "operator"` y para clientes aprobados `role: "viewer"`. Usa `active: false` para revocar su acceso.

Esta aprobación se hace desde Firebase Console con permisos del proyecto. La aplicación cliente **no puede crear, modificar o darse su propia membresía**, incluso si el usuario es administrador del inventario. No es necesario ni conveniente permitir escrituras públicas en `members`.

Un `viewer` consulta documentos de producto completos de su empresa. Si más adelante se agregan costos o datos internos, deben separarse de la información visible al cliente.

## 4. Publicar las reglas antes de usar la base

Con las dependencias ya instaladas, el proyecto dispone del comando local `firebase` a través de npm; no hace falta instalar la CLI globalmente:

```powershell
npm.cmd run firebase -- login
npm.cmd run firebase -- use --add
```

Selecciona el proyecto correcto. Publica las reglas y los índices incluidos:

```powershell
npm.cmd run firebase -- deploy --project TU_PROJECT_ID --only firestore
```

Reemplaza `TU_PROJECT_ID` por el ID del proyecto configurado en `.env.local`. No ejecutes `firebase init` sobre el proyecto: la configuración ya se incluye y no necesitas sobrescribirla.

Completa la membresía inicial y esta publicación **antes del primer uso del inventario**. No copies reglas del tipo `allow read, write: if true` para desbloquear errores. Las reglas incluidas verifican sesión, pertenencia activa, rol, campos y coherencia del SKU. Solo `admin` elimina productos; `operator` puede crear, editar y recibir; `viewer` solo consulta.

## 5. Ejecutar y comprobar el tiempo real

```powershell
npm.cmd run dev
```

Inicia sesión y registra una prenda de prueba. En otra ventana o dispositivo abre la misma aplicación, inicia sesión con un miembro activo de la misma empresa y observa el cambio sin recargar.

La implementación real está en `src/hooks/useProducts.js`: utiliza `onSnapshot` sobre la colección de productos y cancela la escucha al desmontar/cambiar la sesión. `src/hooks/useAuth.js` escucha la cuenta y su membresía; revocar `active` debe retirar el acceso. El estado de caché y errores permite diferenciar una vista todavía sin confirmar de datos recibidos del servidor.

El patrón esencial del hook es:

```jsx
useEffect(() => {
  if (!user) return

  const productsQuery = query(
    collection(db, 'organizations', companyId, 'products'),
    orderBy('name'),
  )

  return onSnapshot(
    productsQuery,
    { includeMetadataChanges: true },
    (snapshot) => {
      setProducts(snapshot.docs.map((item) => ({
        ...item.data(),
        id: item.id,
      })))
    },
    (error) => setError(error.message),
  )
}, [user])
```

El ejemplo muestra el mecanismo, no un archivo adicional que debas copiar: las importaciones, configuración y estados ya están implementados en el hook. No agregues otra suscripción en `App.jsx`.

## 6. Formato y flujo QR

El producto existente se identifica con su SKU simple o un JSON versionado. Ejemplo mínimo:

```json
{
  "v": 1,
  "type": "inventory-product",
  "id": "ID_REAL_DEL_DOCUMENTO",
  "sku": "EX-JN-101-32-AZ-L001"
}
```

Para prellenar un producto nuevo se admiten campos **en el mismo nivel**, sin envoltorio `data`:

```json
{
  "v": 1,
  "type": "inventory-product",
  "sku": "EX-JN-101-32-AZ-L001",
  "name": "Jean cargo azul",
  "description": "Jean cargo para hombre",
  "category": "Jeans",
  "reference": "JN-101",
  "size": "32",
  "color": "Azul",
  "lot": "L001",
  "imageUrl": "https://ejemplo.com/jean-azul.jpg",
  "price": 95000,
  "stock": 10,
  "minStock": 5,
  "currency": "COP"
}
```

Son ejemplos ficticios. Para etiquetas de productos ya guardados utiliza la generación integrada, que incluye su ID correcto. Los SKU simples admiten letras ASCII, números, punto, guion y guion bajo, hasta 40 caracteres.

No hay `companyId` en el formato QR: la empresa se toma de la sesión/configuración y la búsqueda nunca sale de su ruta. Tampoco se admite un UID, permiso administrativo o URL que se abra automáticamente. Los precios y stock actuales de un producto encontrado se leen desde Firestore, no desde una etiqueta desactualizada.

Archivos principales:

- `src/lib/qr.js`: `parseProductQr(text)` y `makeProductQr(product)`.
- `src/components/QrScanner.jsx`: lector con `onScan(decodedText)` y `onClose`.
- `src/components/ProductQr.jsx`: etiqueta del producto.
- `src/lib/products.js`: `getProductBySku(uid, sku)` y transacciones de creación/recepción.

El flujo de operación es:

1. Abre el lector con la cámara o carga una imagen. También puedes pegar el contenido del código.
2. La lectura se entrega una vez y detiene la cámara; no se registra una entrada por cada fotograma.
3. Si existe el producto, revisa referencia, talla y lote y confirma la cantidad de entrada. Si antes habilitaste «Ingreso directo», la lectura suma **una unidad** sin otro formulario; úsalo solo cuando esa sea la operación deseada.
4. Si se trata de datos nuevos válidos, revisa el formulario prellenado y guarda el producto.
5. Los equipos autorizados reciben la actualización de Firestore sin recargar.

La recepción utiliza `receiveProduct(uid, productId, quantity)`, una transacción que suma sobre el stock más reciente. No calcules la nueva cantidad usando un estado antiguo de React. Editar características conserva el stock reciente; las entradas tienen su operación específica.

## Cámara y HTTPS

`getUserMedia` necesita permiso y un contexto seguro. `http://localhost` funciona para la cámara del computador donde corre la aplicación. Una URL HTTP con IP de red no es `localhost` para el celular; por eso abrir `http://192.168...` puede mostrar la web pero bloquear su cámara.

Para la operación móvil publica con HTTPS. Si no se ve la cámara, revisa permisos del sitio, selecciona otra cámara si el dispositivo lo permite y cierra aplicaciones que la estén utilizando. La lectura de una imagen y el ingreso de texto permiten continuar sin cámara.

El selector obtiene los dispositivos con `navigator.mediaDevices.enumerateDevices()`. Mantiene una sola captura por inicio del lector; listar las cámaras no abre una captura auxiliar. Esta precaución evita que la enumeración interrumpa el video activo en navegadores móviles. Después de actualizar el lector, compila y publica Hosting de nuevo y recarga la página del celular para cargar el código actualizado.

La compatibilidad final depende del navegador y el dispositivo. Debe realizarse un piloto físico en los iPhone, Android y computadores reales de la empresa; una prueba automatizada de QR no certifica ese hardware.

## Publicar con HTTPS

Con la configuración y reglas ya verificadas:

```powershell
npm.cmd run lint -- --max-warnings=0
npm.cmd test
npm.cmd run test:cloud
npm.cmd run build
npm.cmd run firebase -- deploy --project TU_PROJECT_ID --only "firestore,hosting"
```

La CLI mostrará la URL HTTPS de Hosting. Autoriza ese dominio en Authentication si corresponde y abre la misma dirección en computador y celular. No se necesita estar en el mismo Wi-Fi para usar la versión publicada; ambos sí necesitan Internet y permisos en la misma empresa.

La cámara necesita que el usuario conceda permiso en cada dispositivo. En Android puedes instalar la PWA desde Chrome; en iPhone, Safari → Compartir → Añadir a pantalla de inicio. La caché de archivos no garantiza que se pueda registrar stock sin conexión.

Este documento explica la publicación; no afirma que el proyecto del usuario haya sido creado o desplegado. No compartas tokens de la CLI o contraseñas por chat.

## Emuladores locales

Instala Java 21 para Firestore y comprueba `java -version`. Desde la carpeta del proyecto ejecuta:

```powershell
npm.cmd run emulators
```

El proyecto de pruebas es `demo-inventario`. Authentication usa el puerto 9099 y Firestore el 8080, ambos en `127.0.0.1`. La interfaz gráfica de Emulator Suite está deshabilitada para evitar dependencias de desarrollo adicionales. En otra terminal:

```powershell
npm.cmd run dev:emulator
```

El modo `emulator` conecta Auth y Firestore locales. Abre la URL de Vite y regístrate con una cuenta ficticia de pruebas. La pantalla «Acceso pendiente de aprobación» muestra su UID. En una tercera terminal apruébalo:

```powershell
node scripts/approve-emulator.mjs TU_UID admin
```

Reemplaza `TU_UID` por el identificador que aparece en pantalla. El helper fija la dirección local `127.0.0.1:8080`, el proyecto `demo-inventario` y la empresa `exlaider-jeans`; no admite destinos cloud ni credenciales reales. Crea el documento de miembro con `active: true`. La pantalla recibe la aprobación en tiempo real. Para probar otros permisos repite con otro usuario y el rol `operator` o `viewer`.

La marca administrativa `Bearer owner` del helper es exclusiva del emulador y no es un mecanismo para dar acceso en producción. Los miembros reales se aprueban únicamente desde Firebase Console/Admin SDK autorizado.

No confundas estos servicios locales con Firebase Console de producción. Los datos del emulador son temporales salvo una importación/exportación explícita y no representan un respaldo cloud.

La configuración admite `VITE_FIREBASE_MODE=emulator` y `VITE_FIREBASE_EMULATOR_HOST` para desarrollo avanzado. Mantén el host por defecto local para el uso normal; no publiques emuladores de desarrollo en Internet. El modo emulador tampoco convierte el HTTP de tu red local en HTTPS para la cámara.

## Pruebas útiles

```powershell
npm.cmd run lint -- --max-warnings=0
npm.cmd test
npm.cmd run test:cloud
npm.cmd run build
```

`test:cloud` inicia emuladores y comprueba las operaciones/reglas; no usa la base de producción. Además, realiza una aceptación en el entorno real:

- Administrador y operador pueden registrar, editar y recibir unidades; solo administrador elimina.
- Un cliente `viewer` puede consultar y no escribir; un usuario sin membresía no puede leer productos.
- Dos entradas simultáneas no pierden incrementos.
- Un SKU duplicado se rechaza.
- El QR se lee por texto, imagen y cámara física; cerrar el lector libera el dispositivo.
- El celular y computador reciben cambios sin recargar con el mismo proyecto y empresa.

Si hay `permission-denied`, revisa primero proyecto, empresa, UID exacto, miembro activo, rol y reglas publicadas. No lo resuelvas relajando la base a acceso público.
