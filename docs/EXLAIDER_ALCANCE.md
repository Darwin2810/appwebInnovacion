# Alcance para EXLAIDER JEANS S.A.S.

La adaptación toma el documento empresarial aportado como contexto: empresa textil de jeans, camuflados y bermudas que necesita centralizar existencias, referencias, tallas, colores y lotes. No se publica el PDF original ni datos personales de sus autores.

Esta versión amplía el inventario a gestión interna integrada de compras, ventas, producción, finanzas y personal. Los módulos comparten empresa, referencias, stock, documentos e historial. La guía operativa está en [ERP.md](ERP.md).

## Necesidades e implementación

| Necesidad | Implementación | Alcance operativo |
| --- | --- | --- |
| Centralizar referencias | Encabezado único y variantes por talla/color/lote/SKU | Una referencia no admite nombres distintos; cada combinación mantiene su stock. |
| Evitar duplicidad | Índices transaccionales y comandos idempotentes | No depende de consultar y guardar por separado desde el navegador. |
| Trabajar desde PC y celular | PWA, Hosting HTTPS y Firestore en tiempo real | Comparte código web; requiere conexión para confirmar operaciones. |
| Preparar etiquetas | QR antes de guardar, con revisión al escanear | Generar una imagen no registra productos ni entradas. |
| Controlar inventario | Recepciones, ajustes con motivo, mínimos y movimientos | Una compra ya ingresa sus unidades; no duplicar su recepción. |
| Separar permisos | Administrador, operador, vendedor y usuario activos | Los costos y módulos privados se autorizan en servidor. |
| Vender y controlar cartera | Ventas, salida de stock, abonos, saldo y anulación | Registra pagos, sin ejecutar cobros externos. |
| Comprar | Proveedor, entrada, costo, pagos y devolución/anulación | Valida stock suficiente al revertir. |
| Seguir producción | Recetas, órdenes, consumo, terminación y cancelación | Materiales en unidad/cm/g; costo hacia proceso y terminado. |
| Consultar finanzas internas | Caja registrada, cartera, proveedores y asientos balanceados | Sin factura electrónica DIAN ni presentación tributaria. |
| Gestionar personal | Empleados, asistencia y nómina interna con pagos | Sin liquidación legal automática ni transmisión electrónica. |
| Centralizar contactos | Directorio de clientes y proveedores | Sin campañas o comunicaciones automáticas. |
| Mantener trazabilidad | Origen, cantidades, UID, fechas, comandos y auditoría | Las correcciones conservan evidencia mediante reversos. |

## Permisos

La [matriz de permisos](PERMISOS_Y_CATALOGO.md) define cuatro roles. Administrador controla catálogo, variantes, archivo, papelera y todos los módulos. Operador únicamente ingresa stock de variantes existentes y consulta sus movimientos. Vendedor registra ventas y cobros propios a precios de catálogo. Usuario sólo consulta prendas. La valoración total y los costos son exclusivos del administrador.

El archivo conserva existencias y permite reactivación. Eliminar con existencias registra su baja y costo, con confirmación y motivo; no borra documentos históricos ni libera SKU. Recuperar devuelve la ficha sin reponer stock. Otro administrador debe retirar el rol o acceso de una cuenta administradora para evitar el bloqueo accidental desde la propia sesión.

El catálogo conserva precio unitario y stock. Esos datos permiten calcular un valor de venta; ocultar el resumen no hace secreta esa operación. Los costos de adquisición y módulos privados se protegen por separado.

## Operación textil

`JN-101` puede identificar «Jean cargo para hombre», con variantes azul/talla 30/lote L1 y negro/talla 32/lote L1. Comparten encabezado y usan SKU distintos. Registrar «Bermuda» con `JN-101` se rechaza. Una corrección del nombre se refleja en todas las variantes, mientras los documentos históricos conservan sus nombres originales.

El responsable verifica cantidades y costos reales. Un costo desconocido queda pendiente; no se estima a partir del precio de venta. Para una recepción se elige compra si existe proveedor/cuenta por pagar, o ingreso directo para una entrada fuera de ese flujo. Un QR con ingreso directo suma una unidad y no debe duplicar una compra ya registrada.

Las recetas usan unidades base explícitas. Iniciar una orden consume materiales; terminarla ingresa la cantidad real con su costo consumido. Si el rendimiento es menor al planificado, ese costo se distribuye sobre las unidades efectivamente ingresadas. Deben revisarse mermas y rendimiento antes de confirmar.

## Adopción y migración

1. Respaldar el proyecto y conservar `.env.local`, cuentas de Authentication y membresías. Preparar backend, reglas e interfaz conjuntamente; la versión nueva no funciona como un reemplazo de HTML aislado.
2. Probar en emuladores y con un grupo controlado. Publicar Functions requiere Blaze; esta preparación no activa el plan.
3. Migrar explícitamente productos anteriores en lotes de hasta 20, reasignando referencias con nombres diferentes. Los documentos antiguos permanecen en solo lectura y los IDs se conservan para las etiquetas existentes.
4. Registrar los costos pendientes, conciliar cantidades físicamente y comprobar los cuatro roles.
5. Ensayar compra, venta con abono, anulación, producción y nómina con documentos de prueba identificables. Capacitar al equipo antes de basar decisiones en los saldos.

Los movimientos nuevos no reconstruyen ventas, pagos ni producción anteriores ausentes. La precisión depende de cargar el inventario inicial y registrar operaciones completas. El plan de adopción del documento empresarial sigue siendo una propuesta; el código no afirma que ya se haya ejecutado.

## Integraciones adicionales

Facturación/nómina electrónica DIAN, obligaciones legales, conciliación bancaria automática, pasarelas de pago, maquinaria industrial, publicación nativa en tiendas, campañas CRM y subida de fotografías a almacenamiento no están integradas. Requieren desarrollo o proveedores según las necesidades de la empresa.

La aplicación implementa los flujos internos descritos; su instalación no certifica cumplimiento legal, contable o laboral. El profesional responsable debe revisar configuración, costos, cuentas y ajustes de nómina.
