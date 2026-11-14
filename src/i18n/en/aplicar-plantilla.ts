// Traducciones al inglés de «Aplicar plantilla» a un proyecto que ya existe (Ajustes del proyecto → Tablero). Clave:
// texto exacto en español.
export const aplicarPlantilla: Record<string, string> = {
  // Sección y deshacer
  "Aplicar plantilla": "Apply template",
  "Aplicar plantilla…": "Apply template…",
  "Añade lo que le falte al proyecto de una plantilla o cámbialo a otra.": "Add what the project is missing from a template, or switch it to another one.",
  "Al cambiar de plantilla, cada columna y cada tipo actual se empareja con uno de la plantilla y sus tareas pasan a él. Nunca se quita nada que tenga tareas, y el cambio se puede deshacer durante un tiempo.":
    "When switching templates, each current column and type is matched with one from the template and its tasks move there. Nothing that has tasks is ever removed, and the change can be undone for a while.",
  "Deshacer el cambio de plantilla": "Undo the template change",
  "Las columnas, tipos y etiquetas vuelven a como estaban antes de aplicar «{name}» y las tareas movidas vuelven a su sitio. Lo que haya recibido tareas después se conserva.":
    "Columns, types and labels go back to how they were before applying “{name}” and the moved tasks return to their place. Anything that has received tasks since then is kept.",
  "Cambio de plantilla deshecho": "Template change undone",
  "Cambio de plantilla deshecho. Se conservan {n} columnas o tipos nuevos porque ya tienen tareas.": "Template change undone. {n} new columns or types are kept because they already have tasks.",
  "Se añadió lo que faltaba de «{name}»": "What was missing from “{name}” was added",
  "Se cambió el proyecto a «{name}»": "The project was switched to “{name}”",
  "Se puede deshacer hasta el": "It can be undone until",
  "No hay ningún cambio de plantilla que deshacer.": "There is no template change to undo.",
  "Ya no se puede deshacer: han pasado más de {h} horas.": "It can no longer be undone: more than {h} hours have passed.",

  // Asistente
  "Plantillas generales": "General templates",
  "Plantillas de la instalación": "Templates of this installation",
  "Qué hacer": "What to do",
  "Añadir lo que falte de la plantilla": "Add what is missing from the template",
  "Añade las columnas, tipos, etiquetas, campos y plantillas de release que el proyecto no tenga, y vuelve a mostrar los tipos generales que usa la plantilla si el proyecto los tiene ocultos. No cambia ni quita nada más.":
    "Adds the columns, types, labels, fields and release templates the project doesn't have, and shows again the general types the template uses if the project hides them. It doesn't change or remove anything else.",
  "Cambiar a esta plantilla": "Switch to this template",
  "Empareja las columnas y los tipos actuales con los de la plantilla y lleva allí sus tareas. Nunca se quita nada que tenga tareas.":
    "Matches the current columns and types with the template's and moves their tasks there. Nothing that has tasks is ever removed.",
  "Siguiente": "Next",
  "Aplicar": "Apply",
  "Plantilla aplicada": "Template applied",
  "Añadido lo que faltaba de la plantilla": "Added what was missing from the template",
  "Solo los administradores pueden usar las plantillas de la instalación.": "Only administrators can use this installation's templates.",
  "Las tareas de cada columna pasan a la que elijas. Una sin pareja se conserva al final; si está vacía, se puede quitar.":
    "The tasks of each column go to the one you choose. A column without a match is kept at the end; if it's empty, it can be removed.",
  "Destino de «{name}»": "Destination of “{name}”",
  "Pasa a la columna de la plantilla": "Goes to the template column",
  "Conservar al final": "Keep at the end",
  "Quitar (está vacía)": "Remove (it's empty)",
  "Las tareas de cada tipo pasan al que elijas, o el tipo se conserva.": "The tasks of each type go to the one you choose, or the type is kept.",
  "general": "general",
  "Ya está en la plantilla": "Already in the template",
  "Conservar": "Keep",
  "Quitar (no tiene tareas)": "Remove (it has no tasks)",
  "Pasa al tipo de la plantilla": "Goes to the template type",
  "Pasa a un tipo general": "Goes to a general type",
  "El proyecto ya tiene todo lo de esta plantilla: no hay nada que cambiar.": "The project already has everything in this template: there is nothing to change.",
  "Si queda alguna columna de la plantilla vacía o sin pareja, se crea igualmente. Las etiquetas en uso se conservan.":
    "Template columns left without a match are created anyway. Labels in use are kept.",
  "Antes de aplicar se guarda cómo está el proyecto: durante {h} horas podrás deshacerlo desde aquí con «Deshacer el cambio de plantilla».":
    "Before applying, the project's current state is saved: for {h} hours you can undo it from here with “Undo the template change”.",

  // Resumen (template-apply-core.ts)
  "Se añadirá {n} columna": "{n} column will be added",
  "Se añadirán {n} columnas": "{n} columns will be added",
  "Se añadirá {n} tipo de tarea": "{n} task type will be added",
  "Se añadirán {n} tipos de tarea": "{n} task types will be added",
  "Se moverá {n} tarea a otra columna": "{n} task will move to another column",
  "Se moverán {n} tareas a otra columna": "{n} tasks will move to another column",
  "Se adaptará {n} columna a la plantilla (nombre, rol u orden)": "{n} column will be adapted to the template (name, role or order)",
  "Se adaptarán {n} columnas a la plantilla (nombre, rol u orden)": "{n} columns will be adapted to the template (name, role or order)",
  "Se quitará {n} columna que se queda vacía": "{n} column left empty will be removed",
  "Se quitarán {n} columnas que se quedan vacías": "{n} columns left empty will be removed",
  "Se conservará al final {n} columna sin pareja": "{n} column without a match will be kept at the end",
  "Se conservarán al final {n} columnas sin pareja": "{n} columns without a match will be kept at the end",
  "{n} columna conservada pierde su rol (la plantilla ya lo usa)": "{n} kept column loses its role (the template already uses it)",
  "{n} columnas conservadas pierden su rol (la plantilla ya lo usa)": "{n} kept columns lose their role (the template already uses it)",
  "Cambiará de tipo {n} tarea": "{n} task will change type",
  "Cambiarán de tipo {n} tareas": "{n} tasks will change type",
  "Se quitará {n} tipo propio que se queda sin tareas": "{n} project type left without tasks will be removed",
  "Se quitarán {n} tipos propios que se quedan sin tareas": "{n} project types left without tasks will be removed",
  "Se ocultará {n} tipo general": "{n} general type will be hidden",
  "Se ocultarán {n} tipos generales": "{n} general types will be hidden",
  "Volverá a verse {n} tipo general": "{n} general type will be shown again",
  "Volverán a verse {n} tipos generales": "{n} general types will be shown again",
  "Se añadirá {n} etiqueta": "{n} label will be added",
  "Se añadirán {n} etiquetas": "{n} labels will be added",
  "Se quitará {n} etiqueta sin uso": "{n} unused label will be removed",
  "Se quitarán {n} etiquetas sin uso": "{n} unused labels will be removed",
  "Se activará {n} campo opcional": "{n} optional field will be turned on",
  "Se activarán {n} campos opcionales": "{n} optional fields will be turned on",
  "Se añadirá {n} plantilla de release": "{n} release template will be added",
  "Se añadirán {n} plantillas de release": "{n} release templates will be added",
  "No caben las etiquetas de la plantilla: el máximo es {max} por proyecto.": "The template's labels don't fit: the maximum is {max} per project.",
  "No caben las columnas de la plantilla: el máximo es {max} por proyecto.": "The template's columns don't fit: the maximum is {max} per project.",
  "No caben los tipos de la plantilla: el máximo es {max} tipos propios por proyecto.": "The template's types don't fit: the maximum is {max} project types per project.",
  "Quedarían {n} columnas y el máximo es {max}: quita o empareja alguna de las que se conservan.": "There would be {n} columns and the maximum is {max}: remove or match some of the ones being kept.",
  "La plantilla no tiene columnas.": "The template has no columns.",

  // Registro y deshacer
  "Añadió lo que faltaba de la plantilla «{name}»": "Added what was missing from the template “{name}”",
  "Cambió el proyecto a la plantilla «{name}»": "Switched the project to the template “{name}”",
  "Deshizo el cambio a la plantilla «{name}»": "Undid the switch to the template “{name}”",
  // «Cambiar a esta plantilla», paso 2: qué pasa con un tipo general que se conserva (lo mismo que dice el resumen).
  "Ocultar (la plantilla no lo usa)": "Hide (the template doesn't use it)",
  "Conservar (volverá a verse)": "Keep (it will be shown again)",

  // Resumen: tareas fijas que dejan de serlo al cambiar de plantilla.
  "{n} tarea fija pasará a ser normal (su columna deja de ser la de release)": "{n} pinned task will become a normal task (its column stops being the release column)",
  "{n} tareas fijas pasarán a ser normales (su columna deja de ser la de release)": "{n} pinned tasks will become normal tasks (their column stops being the release column)",
  // Límites de aplicar y deshacer plantilla (lib/template-apply-rate.ts).
  "Este proyecto ya ha cambiado de plantilla {n} veces en los últimos {w} minutos. Vuelve a intentarlo dentro de {min} min.":
    "This project has already changed template {n} times in the last {w} minutes. Try again in {min} min.",
  "Ya has aplicado o deshecho {n} plantillas en la última hora. Vuelve a intentarlo dentro de {min} min.":
    "You have already applied or undone {n} templates in the last hour. Try again in {min} min.",
  "Demasiadas vistas previas de plantillas seguidas. Vuelve a intentarlo dentro de {min} min.":
    "Too many template previews in a row. Try again in {min} min.",
};
