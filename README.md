# Lab Finanzas Itaú UdeC — Sistema de Reservas

Aplicación web (Node.js + Express) para reservar bloques horarios del laboratorio
de finanzas y visualizar la ocupación a lo largo de todo el año. Diseño oscuro
tipo terminal financiera.

## Características

- **Vista Semana**: grilla horaria tipo agenda; clic en un bloque libre para reservar.
- **Vista Mes**: calendario con las reservas de cada día y lista de próximas reservas.
- **Vista Año**: mapa de calor (estilo GitHub) con la ocupación diaria de los 12 meses.
- **Reserva con validación**: sin choques de horario, dentro del horario del laboratorio,
  máximo de horas por reserva, no se permiten fechas pasadas.
- **Aprobación por administrador**: cada reserva entra como *pendiente* y no ocupa el
  horario en firme hasta que un administrador la aprueba. Panel en `/admin` (o el ícono
  ⚿) con pestañas Pendientes / Aprobadas / Todas y acciones aprobar · rechazar · eliminar.
  Un bloque pendiente aparece rayado en el calendario hasta que se resuelve.
- **Código de cancelación**: cada reserva entrega un código de 6 caracteres necesario
  para cancelarla o consultar su estado.
- **Filtro** por curso, nombre o motivo, y panel de estadísticas del periodo
  (reservas, horas, % de ocupación, horas por curso).

## Requisitos

- Node.js 18 o superior

## Puesta en marcha

```bash
npm install
npm run schedule   # carga el horario académico del semestre (ver más abajo)
npm start
```

Luego abre <http://localhost:3000>. El panel de administración está en
<http://localhost:3000/admin>.

### Contraseña de administrador

`npm start` lee el archivo `.env` (ignorado por git). Define ahí la clave:

```
ADMIN_PASSWORD="tu-clave-secreta"
```

Si no hay `.env` ni variable `ADMIN_PASSWORD`, se usa `bloomberg-admin`
(solo para pruebas locales). Para cambiar la clave, edita `.env` y reinicia.

Para desarrollo con recarga automática:

```bash
npm run dev
```

## Horario académico fijo

[`schedule.js`](schedule.js) **borra todas las reservas** y carga el horario recurrente
del semestre (lun 10-ago-2026 → vie 11-dic-2026). Edita la constante `WEEKLY` para
cambiar bloques, responsables o correos, y vuelve a ejecutar:

```bash
npm run schedule
```

## Configuración

Edita `LAB_CONFIG` en [`server.js`](server.js) para ajustar horario, días de apertura,
número de terminales, duración máxima por reserva y el listado de cursos.

## Almacenamiento

Las reservas se guardan en `data/reservations.json` (escritura atómica, sin base de
datos externa). Borra ese archivo para reiniciar el sistema.

## API

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/config` | Configuración del laboratorio |
| `GET` | `/api/reservations?from=YYYY-MM-DD&to=YYYY-MM-DD` | Reservas en el rango |
| `GET` | `/api/stats?from=&to=` | Métricas de ocupación del rango |
| `POST` | `/api/reservations` | Crear reserva (queda `pending`) |
| `GET` | `/api/reservations/:id?code=` | Consultar estado de una reserva por código |
| `POST` | `/api/reservations/:id/cancel` | Cancelar reserva (requiere `{ code }`) |
| `POST` | `/api/admin/login` | Inicia sesión de administrador → `{ token }` |
| `GET` | `/api/admin/reservations?status=` | Listado completo (Bearer token) |
| `POST` | `/api/admin/reservations/:id/approve` | Aprobar |
| `POST` | `/api/admin/reservations/:id/reject` | Rechazar (`{ note }` opcional) |
| `DELETE` | `/api/admin/reservations/:id` | Eliminar de forma permanente |

Para operar sin aprobación (reservas confirmadas al instante), pon
`requireApproval: false` en `LAB_CONFIG`.
