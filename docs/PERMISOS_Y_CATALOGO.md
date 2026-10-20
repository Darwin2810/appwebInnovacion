# EXLAIDER 2.1 · Permisos y catálogo agrupado

La política se adapta al trabajo solicitado para EXLAIDER. **Administrador** dirige y corrige; **Operador** recibe unidades de artículos existentes; **Vendedor** vende y registra cobros de sus ventas; **Usuario** consulta. El servidor comprueba la autorización en cada operación; ocultar botones no concede ni revoca permisos por sí solo.

## Matriz de permisos

| Acción | Administrador `admin` | Operador `operator` | Vendedor `seller` | Usuario `viewer` |
| --- | --- | --- | --- | --- |
| Consultar prendas, tallas, colores, lotes, stock y QR | Sí | Sí | Sí | Sí |
| Mostrar precio unitario en la interfaz | Sí | No | Sí | Sí |
| Consultar materias primas | Sí | Sí | No | No |
| Crear referencias, variantes y QR antes de guardar | Sí | No | No | No |
| Editar nombres, SKU, tallas, colores, mínimos y precios | Sí | No | No | No |
| Ingresar stock positivo de variantes activas, manual o QR | Sí | Sí | No | No |
| Consultar movimientos | Todos | Sólo los registrados por su cuenta | No | No |
| Registrar ventas y sus pagos | Todas | No | Sólo propias, a precio de catálogo | No |
| Modificar precio de venta o anular una venta | Sí | No | No | No |
| Asignar/reasignar una venta a un vendedor activo | Sí | No | No | No |
| Archivar, eliminar, recuperar, ajustar o valorar inventario | Sí | No | No | No |
| Ver «Valor del inventario», costos o finanzas de la empresa | Sí | No | No | No |
| Compras, producción, personal, usuarios y auditoría | Sí | No | No | No |

La tarjeta agregada se limita al administrador; los costos de adquisición permanecen en documentos privados que los demás roles no pueden consultar. El operador trabaja con cantidades y la interfaz omite precios. El precio unitario sigue siendo un campo público del catálogo autorizado, junto con el stock: quien consulte ambos mediante el SDK puede calcular por su cuenta un valor de venta. No equivale a consultar los costos privados.

Los vendedores no consultan la colección privada `sales`. Sus ventas se publican en `salesDesk` mediante una lista explícita de campos permitidos, sin costos ni margen. Las reglas exigen que `sellerUid` corresponda a la cuenta conectada; la consulta también filtra por ese UID. Registrar un pago es un registro interno, no un cobro bancario. El administrador puede asignar ventas anteriores para que aparezcan al vendedor correspondiente.

Los roles se cambian en **Usuarios**, usando el UID de una cuenta que ya existe en Authentication. El registro público nunca se aprueba automáticamente. Un administrador no puede quitarse a sí mismo su acceso desde esa sesión; otro administrador puede hacerlo. Los cambios de rol o suspensión se aplican a las escuchas en tiempo real y se vuelven a comprobar dentro de las transacciones del backend.

## Una referencia, un producto, varias combinaciones

El catálogo inicial presenta un producto por referencia. Por ejemplo, **A5 · Bermuda camuflada** reúne sus variantes, aunque tengan varios colores, tallas y lotes. Pulsa **Ver variantes de A5**:

1. Elige un color.
2. Elige una talla disponible para ese color.
3. Elige el lote, cuando haya varios.
4. Consulta el SKU exacto, su precio, stock y mínimo. Las combinaciones inexistentes no se ofrecen como artículos nuevos y una variante sin existencias sigue identificándose como tal.

El administrador dispone además de la tabla de variantes y controles del producto completo. Puede añadir otras tallas/colores, corregir la referencia común y administrar cada SKU. Una variante nueva toma como precio inicial el de la familia existente, sujeto a revisión antes de guardar. El servidor no permite usar la misma referencia para nombres diferentes ni repetir una combinación talla/color/lote o reciclar un SKU reservado.

El operador sólo encuentra el ingreso de stock. Un QR desconocido no le permite crear un producto: debe registrarlo primero un administrador. Escanear un QR existente usa los datos actuales del catálogo; una etiqueta antigua no cambia los precios ni reemplaza las existencias.

## Archivo, papelera y recuperación

**Archivar** retira una variante o una referencia de la operación habitual y conserva sus unidades y costos. Por eso un artículo archivado con stock sigue formando parte de los saldos del administrador. No admite nuevas ventas, recepciones ni consumos normales hasta reactivarlo. El archivo del producto completo afecta a todas sus variantes por el estado del encabezado.

**Eliminar** envía el artículo a la papelera. Requiere un motivo y escribir el SKU o la referencia de confirmación. Si tiene stock, registra explícitamente su baja completa: movimiento de salida, costo retirado y asiento de pérdida de inventario cuando corresponde. No lo uses para ocultar un producto que todavía tienes físicamente: en ese caso, archívalo. Los SKU, ventas, movimientos, costos históricos, auditoría y asientos permanecen reservados y consultables por el administrador.

La eliminación del producto completo es atómica hasta 100 variantes no eliminadas. Si supera ese límite, no se elimina parcialmente: el administrador debe retirar primero variantes desde su detalle. No se borra la colección histórica ni se reutilizan etiquetas de artículos eliminados.

**Recuperar** devuelve la ficha desde la papelera; no repone automáticamente las unidades dadas de baja. Su stock continúa en cero. Si existen físicamente, registra después su ingreso real con el motivo y costo adecuados. Una anulación administrativa de venta o producción puede recuperar el artículo y devolver las cantidades y costos históricos de esa operación; el reverso conserva su propia trazabilidad.

El filtro administrativo distingue **Activos**, **Archivados** y **Papelera**. Los demás roles trabajan con artículos activos. Las copias del catálogo anterior no reaparecen cuando una variante migrada se archiva o elimina.

## Actualizar una instalación existente

Conserva tu carpeta anterior como respaldo. Extrae el ZIP nuevo en una carpeta `erp` aparte y copia **únicamente `.env.local`** desde tu instalación actual. Conserva los `package.json`, código, reglas y ambos lockfiles nuevos. No borres Firestore ni vuelvas a crear cuentas.

Desde la carpeta nueva que contiene `package.json`, PowerShell:

```powershell
npm.cmd ci
npm.cmd ci --prefix functions
npm.cmd run lint -- --max-warnings=0
npm.cmd test
npm.cmd run build
npm.cmd run firebase -- login
npm.cmd run firebase -- deploy --project exlaider-inventario --only functions
npm.cmd run firebase -- deploy --project exlaider-inventario --only "firestore,hosting"
```

Publica backend, reglas e interfaz: sólo actualizar Hosting dejaría vigentes los permisos antiguos del servidor. Cuando ambos despliegues indiquen éxito, cierra las pestañas antiguas y vuelve a abrir `https://exlaider-inventario.web.app/`. Conserva el proyecto, la empresa `exlaider-jeans` y las membresías actuales. No requiere convertir automáticamente los datos del catálogo v2: los estados nuevos tienen valores compatibles por defecto.

## Criterios y referencias

- [OWASP · Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): mínimo privilegio, denegar por defecto, comprobar cada petición y la propiedad de los documentos. Se aplica al backend y a las reglas, con pruebas de intentos no autorizados.
- [Odoo · Product variants](https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/products/variants.html): separar la ficha del producto de sus combinaciones de atributos y existencias. La interfaz de EXLAIDER utiliza color, talla y lote con SKU propio.

Estas fuentes orientan el diseño; no establecen un reparto universal de tareas para toda empresa. La matriz anterior expresa las decisiones concretas solicitadas para EXLAIDER.
