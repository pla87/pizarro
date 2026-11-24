// Traducciones al inglés: columnas del tablero (moverlas arrastrando su cabecera, roles según la plantilla, crear una por
// persona, tipo por defecto en la cabecera). Clave: texto exacto en español.
export const columnas: Record<string, string> = {
  // Rol de la columna: primero los que encajan con la plantilla del proyecto
  "Más roles…": "More roles…",
  "Roles pensados para otro tipo de proyecto": "Roles meant for other kinds of project",

  // Mover la columna arrastrando su cabecera o con Alt+flechas
  "{name} (arrastra la cabecera o pulsa Alt+flechas para moverla)": "{name} (drag the header or press Alt+arrows to move it)",
  "«{name}» movida a la posición {n}": "“{name}” moved to position {n}",
  "Has cogido la columna «{title}».": "You picked up the column “{title}”.",
  "La columna «{title}» irá al sitio de {place}.": "The column “{title}” will take the place of {place}.",
  "Has soltado la columna «{title}» en el sitio de {place}.": "You dropped the column “{title}” in the place of {place}.",
  "Has soltado la columna «{title}»: no se mueve.": "You dropped the column “{title}”: it does not move.",
  "Arrastre cancelado: la columna «{title}» vuelve a su sitio.": "Drag cancelled: the column “{title}” goes back to its place.",
  "Movió la columna «{name}» a la posición {n}": "Moved the column “{name}” to position {n}",

  // Tipo por defecto en la cabecera
  "Tipo por defecto: {name}": "Default type: {name}",

  // Organizar por personas («Casa y familia»)
  "Organizar por personas": "Organise by person",
  "Organizar por personas: una columna para cada una": "Organise by person: one column for each",
  "En el proyecto solo hay una persona: añade antes a las demás.": "There is only one person in the project: add the others first.",
  "Todas las personas ya tienen su columna.": "Everyone already has their own column.",
  "Se creará una columna «Asignación a persona» para {names}: lo que entre en ella será de esa persona.":
    "An “Assign to person” column will be created for {names}: whatever goes into it will be theirs.",
  "Se crearán {n} columnas «Asignación a persona», una por persona ({names}): lo que entre en cada una será de esa persona.":
    "{n} “Assign to person” columns will be created, one per person ({names}): whatever goes into each one will be that person’s.",
  "Crear la columna": "Create the column",
  "Crear {n} columnas": "Create {n} columns",
  "1 columna creada": "1 column created",
  "{n} columnas creadas": "{n} columns created",
  "Creó 1 columna «Asignación a persona»": "Created 1 “Assign to person” column",
  "Creó {n} columnas «Asignación a persona»": "Created {n} “Assign to person” columns",
};
