# Encargos

El backend usa MongoDB/Mongoose. La colección `encargos` contiene una solicitud por cliente con uno o varios medicamentos, sus cantidades y precios estimados calculados en el servidor. Los renglones y el historial quedan embebidos para que cada cambio de estado sea atómico. Se conserva una copia de los nombres, precios y dirección aunque después cambie el catálogo o las ubicaciones del usuario.

## Puesta en marcha

1. Desplegar este backend antes del frontend de encargos. No cambian los endpoints de pedidos.
2. Usar la misma conexión `MONGODB_URI` / `MONGO_DB_NAME` del proyecto. Mongoose crea la colección y sus índices con la configuración actual (`autoIndex` habilitado por defecto). No se necesita una migración SQL.
3. Si el despliegue deshabilita `autoIndex`, crear antes de habilitar tráfico el índice único `{ userId: 1, solicitudId: 1 }`, y los índices `{ userId: 1, createdAt: -1 }` y `{ estado: 1, createdAt: -1 }` en `encargos`. El índice único es necesario para impedir duplicados concurrentes.
4. Los renglones antiguos del carrito se interpretan como `modo: 'compra'`; los nuevos pueden ser `compra` o `encargo`.

## API autenticada

Todos los endpoints usan el middleware de autenticación existente. Los clientes solo acceden a sus encargos; admin/editor/super_admin pueden gestionarlos.

- `POST /api/encargos`: `{ solicitudId: UUID, productos: [{ id, cantidad }], tipo_entrega: 'recoger' | 'domicilio', ubicacionId? }`. Cliente (y superadministrador por la política global existente). Entre 1 y 100 productos únicos; cantidades enteras de 1 a 999. Para domicilio se exige el ObjectId de una ubicación del propio usuario. No se aceptan precios ni direcciones libres del cliente. Repetir el UUID devuelve el encargo existente.
- `GET /api/encargos?estado=...`: lista de encargos del usuario o lista general para staff.
- `GET /api/encargos/:id`: detalle con dirección e historial.
- `PATCH /api/encargos/:id/estado`: `{ estado, motivo_cancelacion? }`. Los clientes solo pueden cancelar. El motivo es obligatorio, de 1 a 500 caracteres sin contar espacios externos.

## Estados

| Actual | Siguiente permitido |
| --- | --- |
| pendiente | disponible, cancelado |
| disponible + recoger | entregado, cancelado |
| disponible + domicilio | en_camino, cancelado |
| en_camino | entregado |
| entregado / cancelado | Ninguno |

`disponible` significa que **todos** los medicamentos del encargo ya llegaron. La farmacia registra este evento manualmente y se guarda `disponibleAt`. La actualización compara el estado anterior para detectar modificaciones simultáneas (409). No se cancela después de salir a domicilio o entregarse.

Los encargos representan abastecimiento separado: no descuentan ni reservan existencias del catálogo de venta inmediata y no generan cobros. El total se identifica como estimado en la interfaz. La llegada no convierte automáticamente un encargo en una compra ni modifica el stock de venta; la farmacia debe entregar las unidades recibidas para ese encargo.

## Verificación

`node node_modules/jest/bin/jest.js tests/encargos.test.js --runInBand`

Pruebas HTTP con autenticación real y persistencia simulada: permisos, propietario, direcciones, cantidades, precios del servidor, duplicados, cancelación, transiciones, concurrencia y persistencia de ambos modos del carrito. No contactan una base de producción. Antes de desplegar conviene recorrer recogida y domicilio con la base de pruebas del entorno.

## Productos exclusivos y restricción de existencias

`Producto.solo_encargo` es opcional y vale `false` por defecto. Los medicamentos exclusivos mantienen stock cero; administración puede crearlos, editarlos y eliminarlos con las rutas de productos existentes. Se rechaza stock positivo tanto en creación/edición como en la ruta de ajuste de inventario.

El catálogo y buscador predeterminados excluyen los exclusivos. `GET /api/productos?encargos=true` (o `/buscar?encargos=true`) incluye exclusivos y medicamentos normales con stock cero. Los clientes solo pueden encargar medicamentos con stock cero; la creación y el carrito vuelven a verificarlo en el servidor. Los exclusivos tampoco se pueden comprar desde la API de pedidos. La llegada de un encargo sigue siendo independiente del inventario de venta inmediata.

## Notificaciones en tiempo real

`GET /api/notificaciones` devuelve todas las no leídas y las últimas 100 leídas del usuario autenticado. `PATCH /api/notificaciones/:id/leida` marca únicamente avisos de ese propietario. La colección `notifications` se crea mediante Mongoose con índices por usuario/fecha; no requiere SQL.

Las altas de pedidos/encargos y sus cambios de estado crean avisos persistidos. Socket.IO emite `notificacion_cliente` después de guardar el aviso. Al reconectar, el frontend recupera el historial por HTTP. Un fallo de persistencia del aviso se registra como `notification_failed`; no convierte en fallida una compra ya guardada. Esos fallos requieren revisar los registros y la disponibilidad de MongoDB.

Socket.IO recibe `auth.token`, lo valida con las mismas reglas de cuenta que HTTP y asigna automáticamente la sala del propietario y, cuando corresponde, la sala del personal. Se desconecta al caducar el token. `entrar_sala` ya no permite seleccionar salas desde el cliente. Los visitantes solo reciben los eventos públicos de catálogo.

La sincronización del carrito devuelve `409` con `conflicts` para agotados, stock insuficiente, productos eliminados o encargos que ya tienen existencias. No modifica el carrito remoto mientras existan conflictos. El cliente conserva su borrador y decide cómo resolverlos.

Pruebas: `node node_modules/jest/bin/jest.js --runInBand tests/encargos.test.js tests/notifications.test.js` (con `NODE_ENV=test`). El servidor Socket.IO se prueba con conexiones reales y usuarios simulados; MongoDB se simula en las pruebas.
