# Operación y migración de EXLAIDER ERP

La rama `exlaider-erp` integra catálogo, compras, ventas, producción, finanzas, personal y permisos. Conserva Authentication y la empresa `exlaider-jeans` de la aplicación anterior. Instalación y publicación: [LEEME_VSCODE.md](../LEEME_VSCODE.md) y [FIREBASE_Y_QR.md](FIREBASE_Y_QR.md).

## Preparar el proyecto en VS Code

Descarga [exlaider-erp](https://github.com/Darwin2810/appwebInnovacion/archive/refs/heads/exlaider-erp.zip) y abre la carpeta que contiene `package.json`, `firebase.json` y `functions`. Evita ejecutar npm desde la carpeta exterior creada al extraer el ZIP.

Guarda una copia de la carpeta anterior y de `.env.local`. Conserva tu configuración y las credenciales locales de Firebase; no las sustituyas por los archivos de ejemplo. No borres cuentas, membresías ni colecciones existentes.

En PowerShell, dentro del proyecto:

```powershell
npm.cmd ci
npm.cmd ci --prefix functions
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Se instalan dos archivos lock: aplicación y backend. `npm.cmd` evita el bloqueo de `npm.ps1` que puede aparecer en PowerShell. El backend usa Firebase Functions, Node.js 22 y región `us-east1`. Firebase exige **Blaze** para publicarlo. Esta entrega no activa ese plan ni publica cambios por sí sola. Publicar únicamente Hosting deja los formularios nuevos sin backend; sigue la guía principal para publicar backend, reglas e interfaz.

## Comprobar con emuladores

Los emuladores de Auth, Firestore y Functions usan el proyecto ficticio `demo-inventario`:

```powershell
npm.cmd run emulators
```

En otra terminal de la misma carpeta:

```powershell
npm.cmd run dev:emulator
```

Ese modo fuerza el proyecto de pruebas y evita usar Firebase real. La aprobación del administrador de prueba se explica en [FIREBASE_Y_QR.md](FIREBASE_Y_QR.md). Los datos del emulador no constituyen respaldo del proyecto real.

Para comprobaciones automatizadas, con los emuladores manuales detenidos:

```powershell
npm.cmd run test:cloud
npm.cmd run build -- --mode emulator
npm.cmd run test:browser
```

Los emuladores requieren Java y pueden descargar componentes la primera vez. Las pruebas de navegador utilizan Chrome/Chromium disponible. La automatización está en `.github/workflows/ci.yml`; revisa los resultados de la ejecución correspondiente en GitHub Actions. Las pruebas automáticas no certifican todos los teléfonos físicos de la empresa.

## Referencias, colores, tallas y lotes

1. Crea la referencia e introduce su nombre común, categoría y descripción.
2. Selecciona producto terminado o materia prima y su unidad base. Prendas: unidades; materiales: unidad, cm o g.
3. Añade una fila por talla/color/lote, con SKU único, precio, stock inicial y mínimo. El administrador puede registrar el costo privado.
4. Guarda las variantes. Hay un máximo de 20 por registro; después puedes añadir más a la misma referencia.

El nombre pertenece a la referencia. `JN-101` no puede identificar simultáneamente «Jean cargo» y «Bermuda». Usa otra referencia para un producto diferente. Si se trata de una corrección, administrador u operador pueden editar el encabezado común y actualizar la presentación de todas sus variantes.

No repitas la misma combinación de talla, color y lote con otro SKU. Para sumar unidades utiliza recepción o compra. El tipo y la unidad se definen en el encabezado y no se cambian por variante.

Los SKU anteriores se conservan como alias reservados a la variante para que las etiquetas antiguas sigan identificando el mismo artículo. No pueden reciclarse para otros productos. Se admiten hasta 50 códigos anteriores por variante; las correcciones de códigos no borran la historia.

## QR antes de guardar

Completa los campos y prepara el QR sin guardar. En el formulario de variantes, genera una etiqueta por fila. Incluye los campos permitidos de esa variante, tipo y unidad; no incluye costos privados ni permisos. Los QR anteriores siguen siendo compatibles y se interpretan como producto terminado/unidad cuando no contienen esos campos.

Generar el QR no crea productos ni modifica stock. Al escanear una etiqueta nueva, revisa el formulario y confirma el guardado. Para una variante existente prevalece su ficha vigente; una etiqueta antigua no sustituye el precio o stock actuales.

Un texto muy extenso puede superar la capacidad del QR. Para un borrador que necesita todos los campos, acorta la descripción cuando lo indique la interfaz. En un producto guardado puede generarse una etiqueta compacta que consulta su ficha por identificación.

En iPhone abre la dirección HTTPS de Hosting y concede permiso de cámara. La lectura de imagen QR y el ingreso por texto permiten continuar cuando el dispositivo o navegador no ofrece cámara. Prueba los teléfonos físicos antes de utilizar el lector en bodega.

## Inventario y costos

| Operación | Efecto |
| --- | --- |
| Crear con stock | Existencia inicial y movimiento; con costo, asiento de apertura. |
| Recibir / ingreso QR directo | Suma stock. Si no se indica costo, las unidades nuevas quedan pendientes de valoración y no se inventa un costo. |
| Compra | Suma stock, registra costo, proveedor, cuenta por pagar y pago inicial opcional. |
| Venta | Reduce stock y registra ingreso, costo y cartera; rechaza stock insuficiente. |
| Ajuste administrativo | Corrige cantidades con motivo; usa el costo promedio para la salida y, por defecto, para la corrección positiva. |
| Valorar existencias | Cambia el costo total de las unidades actuales sin alterar cantidades. |
| Archivar/reactivar | Archiva con stock cero y conserva SKU e historial; permite reactivación. |

La compra ya incorpora sus cantidades: no las ingreses otra vez por QR. El ingreso directo corresponde a una entrada fuera del flujo de proveedores. Con costo informado registra la contrapartida de ganancia de inventario; el responsable contable debe comprobar que representa el hecho registrado.

Los costos están en documentos privados. `unvaluedQuantity` indica unidades sin costo conocido; el valor total de adquisición es incompleto mientras existan. Un costo cero informado expresamente se registra como conocido; dejarlo vacío no significa que la prenda no haya costado nada.

Los movimientos conservan responsable, fecha, cantidad anterior/nueva, motivo y origen, sin mostrar costos al operador. Las correcciones no eliminan movimientos.

## Ventas, compras y pagos

El administrador introduce cliente/proveedor y líneas de variantes. El directorio de contactos permite reutilizarlos y el documento conserva su identificación al registrar la operación. Las ventas usan precio de catálogo o precio autorizado introducido; las compras requieren costo por línea.

Puede registrarse un pago inicial y abonos hasta cubrir el saldo. El servidor rechaza pagos superiores a la deuda. Registrar un pago no ejecuta una transferencia ni un cobro bancario.

Anular una venta devuelve stock al costo histórico y compensa ingreso, costo y pagos. Anular/devolver una compra requiere existencias suficientes, retira stock y revierte obligación y pagos registrados, identificando diferencias de valoración. Confirma primero la devolución real de mercancía y dinero: estas acciones registran el hecho, no lo ejecutan fuera de la aplicación.

Los documentos y pagos originales permanecen en el historial con su estado.

## Producción

1. Crea materiales y producto terminado en Inventario. Utiliza unidades base enteras; por ejemplo, 150 cm de tela por jean.
2. Define la receta con insumos y cantidad por unidad terminada.
3. Planifica una orden. Guarda una copia de la receta; editarla después no modifica la orden anterior.
4. Inicia la orden: comprueba disponibilidad, descuenta materiales y traslada su costo a producción en proceso.
5. Finaliza con la cantidad realmente producida, entre una y la planificada. El costo consumido pasa a esas unidades terminadas.

Planificar no consume materiales. Cancelar una orden iniciada repone insumos y revierte producción en proceso. Cancelar una terminada requiere poder retirar sus unidades, restaura materiales y registra diferencias de valoración. Confirma que la reversión representa lo ocurrido físicamente.

Si el rendimiento es menor, el costo consumido se distribuye sobre la cantidad efectivamente ingresada. La receta no incorpora automáticamente mano de obra, gastos indirectos, capacidad ni control de calidad. Los materiales pendientes de valoración se señalan en el resultado.

## Personal y nómina interna

Registra empleados con documento único, cargo, área, salario base y fecha de ingreso. La asistencia se mantiene por empleado/fecha, con estado y minutos. Editar estos datos deja evidencia de la acción.

La nómina interna calcula salario base más adiciones menos deducciones introducidas, con un registro activo por empleado/período `AAAA-MM`. Admite abonos hasta cubrir el neto. Una nómina sin pagos puede anularse con motivo; con pagos requiere conciliación y registro de devolución antes de corregirla.

La asistencia no calcula automáticamente horas extra ni descuentos salariales. No se calculan automáticamente aportes, prestaciones, retenciones legales ni nómina electrónica. Los valores e integraciones legales debe determinarlos el responsable laboral/contable.

## Finanzas, auditoría y permisos

Finanzas muestra asientos y saldos derivados de los registros cargados. Las operaciones valoradas generan partidas balanceadas. Los ingresos/egresos manuales llevan fecha, importe y explicación; no dupliques manualmente asientos ya producidos por ventas, compras o nómina.

La caja es el saldo registrado, no una consulta bancaria. No hay conciliación bancaria, pasarela, factura electrónica DIAN ni presentación tributaria. El profesional contable debe revisar las cuentas y su uso.

Auditoría conserva acción, actor, rol, documento e ID de comando. Los reversos corrigen operaciones sin borrar su rastro.

El primer administrador se conserva desde la membresía existente. Crear una cuenta en Authentication no autoriza su ingreso. En Usuarios, un administrador aprueba un UID existente, asigna `admin`, `operator` o `viewer`, o lo desactiva. No puede retirarse a sí mismo el rol o el acceso: otro administrador debe hacerlo.

El administrador ve todos los módulos y costos. El operador mantiene creación/edición de variantes y encabezados, recepción y movimientos sin costos, sin tarjeta agregada. El viewer conserva consulta de productos terminados y su valor de venta, sin escrituras. Precio unitario y stock permiten calcular un valor de venta por cuenta propia; los costos de adquisición sí permanecen en documentos privados.

## Migración segura

La actualización no transforma ni borra automáticamente `products`. Durante la transición, sus registros se muestran en solo lectura junto con los nuevos. Cada producto deja de aparecer como anterior cuando existe su variante migrada con el mismo ID.

1. Conserva un respaldo/exportación de Firestore y la configuración antes de actualizar.
2. Entra como administrador y abre la migración de productos anteriores.
3. Revisa nombre, referencia, SKU, talla, color, lote y stock; selecciona hasta 20 por lote.
4. Si una referencia identifica nombres distintos, escribe otra para el producto que corresponda. No se fusionan silenciosamente.
5. Confirma y verifica variantes, cantidades y movimientos; continúa con los demás lotes.
6. Valora los costos que falten y concilia con el conteo físico.

Se mantiene el ID original para las etiquetas por ID y se conservan los SKU. Si el SKU anterior estaba vacío se genera `LEGACY-…`. En la interfaz debes escribir una referencia válida cuando falte o sea incompatible; la API también admite generar `LEG-…` cuando se omite una referencia anterior vacía. Los códigos generados son estables y deben revisarse. Los precios anteriores en COP se convierten a centavos; **no se convierten en costos**.

Dos filas anteriores con una misma combinación de referencia/talla/color/lote, o un SKU ocupado, rechazan el lote sin sobrescribir. Corrige la asignación y reintenta. Un ID ya migrado se omite; se conservan el documento anterior y el registro de migración.

Las referencias pendientes también se comprueban al crear variantes o cambiar el nombre del encabezado, incluso si el SKU nuevo es diferente o la referencia anterior tenía otras mayúsculas/espacios. Migra o reasigna primero los registros que pertenezcan a un producto distinto. Si ya están migrados, sus copias antiguas no impiden corregir el nombre canónico. Para conflictos repartidos en varios lotes, migra primero los productos que necesitan otra referencia.

La comprobación de compatibilidad lee referencia/nombre del catálogo anterior por páginas de 200; conservar esas copias implica lecturas adicionales. Antes de trabajar con un histórico muy grande, revisa el costo y la preparación de un índice normalizado con el responsable técnico.

Las reglas nuevas bloquean escrituras de clientes antiguos. Coordina la publicación del backend y la interfaz, cierra pestañas antiguas y recarga la PWA actualizada antes de continuar. La URL previa de Hosting no incorpora por sí sola las Functions nuevas.

## Alcance

La aplicación integra operaciones internas y trazabilidad transaccional. Sus resultados dependen de cantidades, costos y hechos registrados. No reconstruye operaciones ausentes ni certifica cumplimiento legal, tributario o laboral. Véase [EXLAIDER_ALCANCE.md](EXLAIDER_ALCANCE.md) para integraciones adicionales.
