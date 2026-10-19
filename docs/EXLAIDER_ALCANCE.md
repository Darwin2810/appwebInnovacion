# Alcance para EXLAIDER JEANS S.A.S.

La adaptación utiliza el documento empresarial aportado, en especial el rediseño de procesos de la sección 7.4, el plan de adopción de la sección 8.5 y las conclusiones. Se trata de una empresa textil de jeans, camuflados y bermudas que necesita inventario centralizado, identificación por referencia/talla/lote y consulta para clientes aprobados.

El PDF sirve como referencia de negocio; no se incluye su archivo original ni datos personales de sus autores en el proyecto.

## Correspondencia

| Necesidad | Implementación | Límite |
| --- | --- | --- |
| Sustituir registros manuales | Formulario con prenda, referencia, talla, color, lote y SKU | La empresa debe contar y verificar el inventario inicial. |
| Conocer cantidades en tiempo real | Firestore y suscripciones por empresa | Requiere conexión y proyecto configurado. |
| Registrar por escáner móvil | Cámara, imagen QR o texto; recepción confirmada | Un QR identifica o prellena; no autentica una prenda ni concede acceso. |
| Identificar faltantes | Stock mínimo y alertas visuales | No genera compras ni envía alertas externas. |
| Mostrar referencias, fotos, tallas y precios | Foto por URL HTTPS y rol `viewer` | Es consulta autenticada, no tienda con pagos ni catálogo público. |
| Separar dueño, operarios y clientes | `admin`, `operator`, `viewer` con membresía activa | Los permisos se aprueban en Firebase Console. |
| Registrar referencia/talla/lote | Campos explícitos y responsables/fechas | No hay trazabilidad individual ni historial completo de movimientos. |
| CRM y analítica comercial | Arquitectura extensible | No se han implementado ventas, CRM ni análisis de rotación. |

## Operación recomendada

Definir un SKU por variante que se cuenta por separado. Por ejemplo, `EX-JN-101-32-AZ-L001` representa una referencia, talla, color y lote. Una talla o lote diferente usa otro código. El SKU es único dentro de la empresa.

El responsable de bodega verifica nombres, cantidades, mínimos y precios antes de iniciar. Un administrador del proyecto autoriza al equipo interno como `operator` y a clientes aprobados como `viewer`. Una cuenta de consulta ve los campos del documento de producto; un futuro catálogo que oculte información interna requiere documentos separados.

Al escanear, el operador revisa referencia, talla y lote y confirma la cantidad recibida. Cada fotograma de un QR no es una nueva entrada. Los datos QR para un producto nuevo prellenan el formulario y pasan por la validación antes de guardarse.

## Adopción gradual

El plan de seis meses del documento es una propuesta, no una afirmación de que ya se haya completado. Para el módulo entregado se recomienda:

1. Configurar Firebase, aprobar usuarios y cargar un grupo pequeño de referencias/tallas/lotes comprobados físicamente.
2. Probar con un computador y dos celulares mediante HTTPS: alta manual, escaneo, entradas simultáneas y consulta de clientes.
3. Capacitar en la diferencia entre crear una referencia y recibir unidades; permisos de cámara y manejo de falta de conexión.
4. Digitalizar las demás referencias y establecer conciliaciones, mantenimiento y respaldos.

Los primeros indicadores pueden ser porcentaje de referencias digitalizadas, tiempo por entrada, diferencias frente al conteo físico y personal capacitado. Sin ventas y movimientos históricos no se pueden calcular rotación o demanda de forma confiable.

## Próximas fases

- Historial inmutable de entradas/salidas, motivo, responsable e identificador de operación.
- CRM con clientes, contactos, consentimiento y seguimiento.
- Pedidos, ventas, devoluciones y reservas de stock.
- Catálogo mayorista con información separada por perfil.
- Reportes Excel y análisis de rotación basados en movimientos reales.
- Carga de fotografías a almacenamiento administrado y estrategia de respaldos.
- Producción, insumos, calidad y conexión contable.

Esta entrega cubre el ingreso y la gestión de productos. No constituye un ERP/CRM completo.
