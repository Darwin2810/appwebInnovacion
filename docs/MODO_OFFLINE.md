# Trabajo sin conexión

EXLAIDER puede seguir registrando las operaciones esenciales cuando se pierde internet. La información pendiente se cifra en el dispositivo y se sincroniza automáticamente al recuperar una conexión estable.

## Preparar el dispositivo

1. Abre la aplicación con internet e inicia sesión al menos una vez.
2. Entra a Inventario y, si corresponde a tu rol, a Ventas para guardar la información reciente en el dispositivo.
3. En iPhone, abre la aplicación en Safari, pulsa **Compartir** y **Agregar a inicio**. En computador puede instalarse desde la opción de instalación del navegador.
4. No borres los datos del sitio ni desinstales la aplicación mientras existan operaciones pendientes.

Las imágenes de productos quedan disponibles sin conexión después de haberlas abierto una vez en ese dispositivo.

## Operaciones disponibles

| Operación | Administrador | Operador | Vendedor |
| --- | --- | --- | --- |
| Ingreso de stock | Sí | Sí | No |
| Ajuste de conteo | Sí | No | No |
| Registrar venta | Sí | No | Sí |

Los cambios de usuarios, precios, productos, compras, pagos, finanzas y demás acciones sensibles requieren conexión. El servidor vuelve a comprobar los permisos y las reglas de negocio al sincronizar.

## Sincronización y conflictos

- La barra superior indica **Sin conexión** y el número de operaciones pendientes.
- Al volver internet, deja la aplicación abierta o ábrela nuevamente. La sincronización comienza sola.
- Cada operación conserva un identificador único: si se reintenta por una interrupción, el servidor no debe aplicarla dos veces.
- Si el servidor rechaza una operación porque cambió el stock o ya no es válida, aparecerá en **Operaciones sin conexión** como error. Revísala y usa **Reintentar** o **Descartar**.
- En iPhone la sincronización en segundo plano puede suspenderse; abre la aplicación después de recuperar internet para asegurar que termine.

El modo sin conexión utiliza la última información que el dispositivo alcanzó a guardar. Por eso una venta puede quedar en conflicto si otro usuario agotó ese stock mientras el dispositivo estaba desconectado.
