# EXLAIDER JEANS S.A.S. · Inventario conectado

Aplicación de inventario para computador, iPhone y Android con una misma interfaz React adaptable. El registro manual, la lectura de QR y las existencias comparten Cloud Firestore; las pantallas autorizadas reciben cambios sin recargar.

## Stack recomendado

| Capa | Tecnología | Por qué |
| --- | --- | --- |
| Frontend compartido | React + Vite + JavaScript | Aprovecha el proyecto existente y comparte componentes, formularios y lógica entre dispositivos. |
| Instalación | PWA | Se añade a la pantalla de inicio sin mantener dos aplicaciones nativas. |
| Identidad | Firebase Authentication, correo/contraseña | Identifica a cada persona antes de consultar el inventario. |
| Backend y base de datos | Firestore + reglas de seguridad | Suscripciones en tiempo real, transacciones y permisos por empresa sin administrar un servidor propio. |
| QR | html5-qrcode + qrcode | Cámara o imagen para leer; generación de etiquetas para identificar prendas. |
| Publicación | Firebase Hosting | HTTPS para usar la cámara desde el celular. |

La PWA funciona en navegadores compatibles de escritorio, iOS y Android. No incluye binarios nativos ni publicación en App Store o Play Store. Si se requiere distribución en tiendas, se puede evaluar Capacitor en una fase posterior.

## Funciones

- Registro y edición de nombre, SKU, descripción, categoría, referencia, talla, color, lote, foto por URL HTTPS, precio COP, stock y mínimo.
- Búsqueda, filtro, resumen del inventario y señalización de existencias bajas.
- Lectura de QR con cámara, archivo de imagen o contenido escrito. Un producto existente se consulta en la empresa actual; los datos de uno nuevo prellenan el formulario para revisión.
- Entrada de unidades con confirmación y transacción para evitar perder incrementos simultáneos. Opcionalmente, el operador puede activar «Ingreso directo» para sumar una unidad al leer un producto existente.
- Generación de etiquetas QR y sincronización mediante `onSnapshot`.
- Miembros activos con roles `admin`, `operator` y `viewer`. Los clientes previamente aprobados consultan sin modificar.

El documento aportado de EXLAIDER orientó los campos referencia/talla/lote, las prendas y la separación entre administración y consulta. Esta entrega cubre el inventario y el ingreso de productos; CRM, ventas y reportes de rotación son fases posteriores. Consulta [el alcance](docs/EXLAIDER_ALCANCE.md).

## Ejecutar en VS Code

Instala Node.js 24 LTS y abre la carpeta que contiene `package.json`. En PowerShell usa `npm.cmd` para evitar el bloqueo de `npm.ps1` sin cambiar la política de Windows.

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

Antes de usar la nube, completa `.env.local`, habilita Authentication y Firestore, autoriza las cuentas y publica las reglas. Sigue [la configuración paso a paso](docs/FIREBASE_Y_QR.md). La configuración web Firebase es pública; nunca coloques una clave privada de cuenta de servicio en el frontend.

Para trabajar sin un proyecto de producción se incluyen emuladores de Auth y Firestore. Requieren Java 21 y dos terminales: `npm.cmd run emulators` y `npm.cmd run dev:emulator`. Los datos de los emuladores no se envían a producción.

## Validar

```powershell
npm.cmd run lint -- --max-warnings=0
npm.cmd test
npm.cmd run test:cloud
npm.cmd run build
```

`test:cloud` utiliza Firebase Emulator Suite y requiere Java 21. No verifica un despliegue real. `npm.cmd run preview` permite revisar la compilación localmente; no publica el sitio.

## Cámara y uso en dos dispositivos

La cámara necesita permiso y un contexto seguro: HTTPS o `localhost` en el propio dispositivo. Una URL como `http://192.168.1.10:5173` sirve para visualizar la web en la red local, pero normalmente no permite usar la cámara del celular. Publica en Firebase Hosting y abre la misma URL HTTPS en ambos equipos.

Ambos usuarios necesitan conexión, el mismo proyecto Firebase y pertenecer a la misma empresa. No hay un reemplazo silencioso por inventarios independientes en `localStorage`. La caché de la PWA corresponde a la interfaz; no garantiza operaciones de inventario sin conexión.

## Guías

- [Abrir y ejecutar en Windows](LEEME_VSCODE.md).
- [Arquitectura, estructura y modelo de datos](docs/ARQUITECTURA.md).
- [Firebase, permisos, QR, emuladores y publicación](docs/FIREBASE_Y_QR.md).
- [Alcance empresarial y próximas fases](docs/EXLAIDER_ALCANCE.md).

No se incluyen el PDF original, datos personales de sus autores ni credenciales reales. Configurar los archivos no crea por sí solo una base de datos de producción. La validación con emuladores no sustituye una prueba física de cámara en iPhone y Android.
