# EXLAIDER JEANS SAS · Gestión conectada

Aplicación React instalable como PWA en computador, iPhone y Android. Firebase Authentication identifica al usuario; Firestore sincroniza lecturas; Firebase Functions valida cada operación y registra stock, costos, asientos y auditoría en una transacción.

## Funciones

- Catálogo agrupado por referencia; detalle con colores, tallas y lotes, cada combinación con SKU y stock propios.
- Archivo con existencias, papelera con baja trazable y recuperación de fichas sin reponer automáticamente stock.
- Ingreso manual o por QR; preparar y descargar un QR completo **antes de guardar** el producto no crea inventario.
- Materias primas en unidades, centímetros o gramos; stock entero y costos de adquisición separados del precio de venta.
- Ventas, compras, cuentas pendientes, pagos parciales y anulaciones con contrapartidas.
- Recetas y órdenes de producción: materiales → producción en proceso → producto terminado.
- Empleados, asistencia, nómina interna con ajustes explícitos y pagos.
- Directorio de clientes/proveedores, caja, diario contable, panel de dirección, autorización de usuarios y auditoría.
- Migración explícita del inventario anterior: conserva documentos e identificadores, señala referencias conflictivas y no inventa costos.

## Permisos

| Función | Administrador | Operador | Vendedor | Usuario |
|---|---|---|---|---|
| Consultar prendas, stock y QR | Sí | Sí | Sí | Sí |
| Mostrar precio unitario en la interfaz | Sí | No | Sí | Sí |
| Crear y editar productos, referencias, variantes y precios | Sí | No | No | No |
| Ingresar stock positivo de variantes activas | Sí | Sí | No | No |
| Consultar movimientos | Todos | Propios | No | No |
| Registrar ventas y cobros | Todas | No | Propios, precio de catálogo | No |
| Cambiar precios de venta, anular o asignar ventas | Sí | No | No | No |
| Ver valor agregado, costos y módulos administrativos | Sí | No | No | No |
| Ajustar, valorar, archivar, eliminar, recuperar y migrar | Sí | No | No | No |

Los costos y documentos privados se protegen con reglas y comprobación de rol en el servidor. El catálogo conserva precio unitario y stock: quien lo consulta puede calcular su valor de venta; los costos de adquisición permanecen privados. Consulta la [matriz completa y la guía del catálogo](docs/PERMISOS_Y_CATALOGO.md).

## Instalar en VS Code

Lee [LEEME_VSCODE.md](LEEME_VSCODE.md). Instala Node.js 22 LTS (24 también sirve para desarrollar; Functions se publica con Node22). En PowerShell, desde la carpeta que contiene este `package.json`:

```powershell
npm.cmd ci
npm.cmd ci --prefix functions
Copy-Item .env.example .env.local
npm.cmd run dev
```

Completa `.env.local` con la configuración pública de **tu** proyecto antes de usar la nube. No reemplaces tu archivo existente si estás actualizando. El backend Functions necesita plan **Blaze**; este código no activa facturación ni publica cambios automáticamente. El desarrollo con emuladores no requiere Blaze ni datos de producción.

## Pruebas y emuladores

Requieren Java 21 para Firestore. Usa dos terminales:

```powershell
npm.cmd run emulators
```

```powershell
npm.cmd run dev:emulator
```

El modo emulador fija el proyecto `demo-inventario` aunque exista `.env.local` de producción. Crea una cuenta en la interfaz y autorízala con `node scripts/approve-emulator.mjs UID admin` (sólo demo local).

```powershell
npm.cmd run lint -- --max-warnings=0
npm.cmd test
npm.cmd run test:cloud
npm.cmd run build
npm.cmd run build -- --mode emulator
npm.cmd run test:browser
```

`test:cloud` comprueba reglas y servicios reales contra Firestore emulado. `test:browser` inicia Auth, Firestore y Functions y usa Chrome/Chromium con sesiones aisladas por rol. Las pruebas usan datos sintéticos; no certifican cámaras físicas ni un despliegue de producción. El flujo de CI está en `.github/workflows/ci.yml`.

## Documentación

- [Configuración Firebase, cámara y QR](docs/FIREBASE_Y_QR.md).
- [Permisos, catálogo agrupado, archivo y papelera](docs/PERMISOS_Y_CATALOGO.md).
- [Modelo, flujos y migración del ERP](docs/ERP.md).
- [Arquitectura](docs/ARQUITECTURA.md).
- [Alcance y límites](docs/EXLAIDER_ALCANCE.md).

La contabilidad y nómina son de gestión interna. No se implementan facturación electrónica DIAN, liquidación legal automática, transferencias bancarias ni integración contable certificada. Un pago registra un movimiento interno; no mueve dinero en una entidad financiera.
