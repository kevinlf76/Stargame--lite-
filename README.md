# Stargame Elite — prototipo público de cuentas

Incluye sitio responsive negro/dorado, catálogo de juegos demostrativos, registro e inicio/cierre de sesión, contraseñas con bcrypt, límite de intentos y panel administrativo en `/admin.html`.

## Panel de administración
Configurar en el entorno del servidor las variables privadas `ADMIN_USERNAME` y `ADMIN_PASSWORD`. El usuario debe tener 3-20 caracteres (letras, números o `_`) y la contraseña entre 10 y 72 caracteres. Al iniciar el servidor se crea esa cuenta como administradora o se le asigna el rol admin si ya existía. No guardar estos secretos en GitHub ni compartirlos. Ingresar al sitio con esa cuenta y abrir `/admin.html` para listar, crear y eliminar cuentas de prueba. No se muestran ni recuperan contraseñas.

## Ejecución local
Requiere Node.js 20+. Ejecutar `npm install`, configurar `.env` a partir de `.env.example` con secretos propios y luego `npm start`. Abrir `http://localhost:3000`.

## Importante antes de compartir
Esta versión es un prototipo de prueba, no una plataforma lista para producción. Usa SQLite local; en servicios de alojamiento con disco efímero los datos pueden perderse al reiniciar o volver a desplegar. Antes de invitar personas a registrar cuentas, migrar la base de datos y las sesiones a almacenamiento persistente administrado, configurar HTTPS, secretos fuertes, copias de seguridad, verificación/recuperación de cuenta, política de privacidad y revisión de seguridad. No usar contraseñas reales que las personas utilicen en otros servicios.

No procesa depósitos, retiros, apuestas ni premios monetarios. Las apuestas con dinero real requieren autorizaciones y cumplimiento normativo aplicable, además de proveedores de juegos habilitados. No usar el prototipo para operar apuestas.
