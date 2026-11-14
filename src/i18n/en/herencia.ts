// Lo que queda al borrar una cuenta: confirmar la baja escribiendo la contraseña de Google, el aviso a los
// administradores de los proyectos privados que pasan a ser de equipo y abrir un proyecto de equipo que no está en tus
// proyectos.
export const herencia: Record<string, string> = {
  // Baja con Google: Google tiene que volver a pedir la contraseña.
  "Google no te ha pedido la contraseña. Para borrar la cuenta tienes que escribir la contraseña de tu cuenta de Google: vuelve a intentarlo.":
    "Google didn't ask for your password. To delete your account you have to type your Google account password: please try again.",
  "Google te pedirá la contraseña de tu cuenta de Google aunque ya tengas la sesión abierta.":
    "Google will ask for your Google account password even if you're already signed in.",
  // Aviso a los administradores: un proyecto privado pasa a ser de equipo.
  "El proyecto {task} de {actor} ha pasado a ser de equipo al borrarse su cuenta": "{actor}'s account was deleted: the project {task} is now a team project",
  "Ahora lo ven los administradores. Ábrelo para darle miembros, añadirlo a tus proyectos o borrarlo.":
    "Admins can see it now. Open it to give it members, add it to your projects or delete it.",
  "Como administrador, con las menciones te llegan también los avisos de proyectos privados que pasan a ser de equipo al borrarse una cuenta (por email y por Telegram o WhatsApp).":
    "As an admin, along with mentions you also get notices about private projects that become team projects when an account is deleted (by email and by Telegram or WhatsApp).",
  // Un proyecto de equipo abierto que no está en «Proyectos en los que trabajo».
  "No está en tus proyectos": "Not in your projects",
};
