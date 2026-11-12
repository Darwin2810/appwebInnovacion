# Importar la base de campo de EXLAIDER

La importación está disponible únicamente para cuentas con rol **Administrador**.

1. Entra a **Inventario** y pulsa **Importar Excel**.
2. Selecciona `DATOS DE CAMPO INNOVACION EMPRESARIAL EXLAIDER.xlsx`.
3. Comprueba el resumen. Con el archivo de campo validado deben aparecer **10 referencias, 16 variantes y 656 unidades**.
4. Revisa los precios tomados de la columna `Precio venta COP`. Puedes aplicar otro valor a todas las variantes o corregir cada fila.
5. Revisa el stock mínimo de cada variante.
6. Marca la confirmación y pulsa **Importar 16 variantes**.

La aplicación usa **Prototipo conteo** como stock inicial de las prendas. En la hoja `Insumos`, suma las cantidades de cada referencia; los botones y cremalleras quedan en unidades y los metros de hilo se convierten a centímetros. Los precios y costos ficticios del archivo se muestran en la vista previa. No interpreta las columnas de entradas, salidas, conteo en papel o diferencia como movimientos históricos, porque hacerlo duplicaría operaciones.

Cada referencia solo puede pertenecer a un nombre de producto. La aplicación impide repetir una combinación de referencia, talla, color y lote. Los identificadores técnicos se generan automáticamente y no aparecen en la interfaz.
