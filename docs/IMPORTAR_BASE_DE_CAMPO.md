# Base de campo de EXLAIDER

## Reinicialización desde VS Code

Usa Node.js 22 y una terminal PowerShell en la raíz de una copia Git del repositorio. Conserva el archivo `.env.local` de producción con la configuración web de Firebase del proyecto EXLAIDER. Usa el valor de `VITE_FIREBASE_PROJECT_ID` en `$project` si tu entorno usa un ID distinto de `exlaider-inventario`.

```powershell
git switch exlaider-erp
git pull --ff-only origin exlaider-erp
npm.cmd ci
npm.cmd run install:backend
npm.cmd run firebase -- login
$project = "exlaider-inventario"
npm.cmd run deploy -- --project $project
node scripts/reset-exlaider.mjs $project
```

El último comando solicita el correo y la contraseña de una cuenta de Firebase Authentication con rol `admin` activo en `organizations/exlaider-jeans/members`. Escribe exactamente `REINICIALIZAR EXLAIDER-JEANS`. La primera ejecución exitosa devuelve `validated: true` y `replayed: false`. Si se pierde la respuesta, repetir el mismo comando consulta el resultado de la misma reinicialización. El marcador persiste en Firestore y bloquea una segunda eliminación, incluso desde otra sesión de administrador.

El backend reemplaza las colecciones operativas de EXLAIDER en una transacción de Firestore. Preserva el documento de la organización, los miembros, las cuentas de Authentication y los comprobantes de comandos de usuarios y permisos. La operación requiere que las eliminaciones y la carga quepan en una única transacción de Firestore. La confirmación solo devuelve éxito tras validar los documentos persistidos y las versiones del documento de la organización y sus miembros.

La base incluida proviene de `DATOS DE CAMPO INNOVACION EMPRESARIAL EXLAIDER 2.xlsx`. Incluye 10 referencias de prendas, 16 variantes, 32 movimientos históricos y 3 insumos. Las prendas cierran con 656 unidades tras 855 entradas y 199 salidas del 23 y 24 de octubre de 2026. Los tres insumos se inicializan con 1.100 unidades de botones, 1.000 unidades de cremalleras y 150 metros de hilo. El archivo carece de costos y precios. Las existencias quedan sin valorar y los precios de venta se registran en cero hasta que el administrador los defina.

## Importar un Excel desde Inventario

1. Entra con rol **Administrador** y pulsa **Importar Excel**.
2. Selecciona el libro con las hojas **Inventario Prendas** e **Insumos**.
3. Revisa el saldo, las entradas, las salidas y los precios disponibles. Confirma la carga.

La hoja de prendas con columna `Fecha` registra la entrada y la salida en movimientos separados con la fecha de cada fila. Los dos conteos aparecen en el detalle para conciliación. Los insumos se agrupan por referencia y mantienen su unidad. Su cantidad aparece en el detalle del producto.

Los archivos anteriores sin `Fecha` conservan la importación por conteo del prototipo y la conversión de metros a centímetros. El importador omite las combinaciones ya existentes de referencia, talla, color y lote.
