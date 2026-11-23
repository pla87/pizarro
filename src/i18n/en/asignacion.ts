// Traducciones al inglés de la columna «Asignación a persona» (persona y plazo, «Generar plan» y su PDF). Clave: texto exacto en español.
export const asignacion: Record<string, string> = {
  // Menú y cabecera de la columna
  "Asignación a persona": "Assign to person",
  "Todo lo que entra se asigna a una persona (y, opcional, con un plazo): botón «Generar plan».": "Everything that comes in is assigned to one person (optionally with a deadline): “Generate plan” button.",
  "La persona de esta columna ya no tiene acceso al proyecto: la columna no asigna. Elige otra.": "This column's person no longer has access to the project: the column doesn't assign. Choose someone else.",
  "Esta columna aún no tiene persona: no asigna. Elige a quién.": "This column has no person yet: it doesn't assign. Choose who.",
  "Cambiar la persona o el plazo de la columna": "Change the column's person or deadline",
  "Vence en 1 día": "Due in 1 day",
  "Vence en {n} días": "Due in {n} days",
  // Pie: «Generar plan»
  "Generar plan": "Generate plan",
  "Elige antes la persona de la columna": "Choose the column's person first",
  "PDF con las tareas de la persona en esta columna, por vencimiento": "PDF with the person's tasks in this column, by due date",
  // Diálogo
  "Todo lo que entre en esta columna se asignará a esta persona.": "Everything that comes into this column will be assigned to this person.",
  "Persona": "Person",
  "Elige una persona": "Choose a person",
  "Elige una persona.": "Choose a person.",
  "Vence en (días, opcional)": "Due in (days, optional)",
  "Sin plazo": "No deadline",
  "Las tarjetas que entren sin fecha límite vencerán ese número de días después. Las que ya tienen fecha la conservan.": "Cards that come in without a due date will be due that many days later. Cards that already have a date keep it.",
  "Indica un número entero de días entre 1 y {max}, o déjalo vacío.": "Enter a whole number of days between 1 and {max}, or leave it empty.",
  "1 tarjeta de «{col}» pasará a {name}.": "1 card in “{col}” will be assigned to {name}.",
  "Las {n} tarjetas de «{col}» que no son de {name} pasarán a esa persona.": "The {n} cards in “{col}” that aren't {name}'s will be assigned to them.",
  "1 tarjeta asignada a {name}": "1 card assigned to {name}",
  "{n} tarjetas asignadas a {name}": "{n} cards assigned to {name}",
  // Registro de actividad
  "Convirtió la columna «{col}» en «Asignación a persona» ({name})": "Turned the column “{col}” into “Assign to person” ({name})",
  "Cambió la persona de la columna «{col}» a {name}": "Changed the person of the column “{col}” to {name}",
  // PDF del plan
  "plan": "plan",
  "persona": "person",
  "Plan de tareas": "Task plan",
  "Plan de {name}": "{name}'s plan",
  "Este mes": "This month",
  "Vence el {date}": "Due {date}",
  "y 1 subtarea más": "and 1 more subtask",
  "y {n} subtareas más": "and {n} more subtasks",
  "1 tarjeta de la columna es de otra persona y no sale en el plan.": "1 card in the column belongs to someone else and isn't in the plan.",
  "{n} tarjetas de la columna son de otras personas y no salen en el plan.": "{n} cards in the column belong to other people and aren't in the plan.",
  "No hay tareas de esta persona en la columna.": "This person has no tasks in the column.",
  // Registro de actividad: cambiar solo el plazo
  "Cambió el plazo de la columna «{col}» a 1 día": "Changed the deadline of the column “{col}” to 1 day",
  "Cambió el plazo de la columna «{col}» a {n} días": "Changed the deadline of the column “{col}” to {n} days",
  "Quitó el plazo de la columna «{col}»": "Removed the deadline of the column “{col}”",
  // Editor de plantillas: columna «Asignación a persona» (solo el plazo)
  "día": "day",
  "días": "days",
  "Días del plazo de la columna {n}": "Deadline days for column {n}",
  // «Nueva tarea» en una columna «Asignación a persona»
  "Esta columna asigna sus tarjetas a {name}": "This column assigns its cards to {name}",
};
