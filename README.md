# Stargame Elite — base inicial

Proyecto inicial de una web con identidad propia, registro, inicio de sesión con **nombre de usuario y contraseña**, sesiones y almacenamiento persistente. Incluye un catálogo visual de juegos de demostración y un historial de actividad por usuario.

**Esta versión NO permite apuestas, depósitos, retiros ni premios con dinero real.** No es una copia de Stake ni incluye juegos comerciales de terceros.

## Requisitos

- Node.js 20 o superior
- npm
- Para probar localmente, una computadora. El proyecto no se ejecuta por sí solo desde un teléfono.

## Ejecutar en una computadora

1. Descomprimí el ZIP.
2. Abrí una terminal dentro de la carpeta del proyecto.
3. Ejecutá `npm install`.
4. Copiá `.env.example` como `.env`.
5. Reemplazá `SESSION_SECRET` por una clave aleatoria larga (al menos 32 caracteres).
6. Ejecutá `npm start`.
7. Abrí `http://localhost:3000` en el navegador.

La base de datos se crea automáticamente en `data/stargame.sqlite`. Las contraseñas se guardan con hash bcrypt; nunca se almacenan como texto plano. Las sesiones se guardan en SQLite.

## Qué incluye

- Alta de usuario con nombre de usuario único y contraseña.
- Inicio y cierre de sesión.
- Cookies de sesión `HttpOnly` y `SameSite`.
- Límite de intentos de autenticación.
- Registro de actividad de demostración por usuario.
- Interfaz responsive en negro y dorado.

## Antes de publicarlo en Internet

Este repositorio es un punto de partida, no una auditoría de seguridad ni una plataforma lista para producción. Antes de desplegarlo:

- Usar HTTPS, dominio propio y secretos robustos.
- Migrar a una base de datos administrada y copias de seguridad cifradas.
- Configurar monitoreo, alertas, retención y restauración de datos.
- Incorporar verificación de correo/recuperación segura de contraseña y controles adicionales contra abuso.
- Hacer una auditoría de seguridad independiente.
- Para cualquier servicio de apuestas con dinero real, obtener primero las licencias y aprobaciones necesarias; implementar KYC/edad, ubicación, límites, autoexclusión, juego responsable, prevención de lavado y controles de auditoría según la normativa aplicable.
- Integrar solo proveedores de juegos y pagos autorizados mediante contratos y especificaciones oficiales.

No cargues datos reales de clientes en esta versión de prueba.
