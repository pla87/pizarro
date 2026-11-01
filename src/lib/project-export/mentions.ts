// Menciones @[Nombre](user:ID) dentro de los textos exportados: el id se cambia por la ref de persona del archivo
// al exportar y por el id del usuario emparejado (o por texto plano) al importar.
const MENTION = /@\[([^\]\n]{1,80})\]\(user:([a-z0-9]{1,40})\)/gi;

export function mapMentions(text: string, fn: (name: string, id: string) => string): string {
  return text.replace(MENTION, (_m, name: string, id: string) => fn(name, id));
}
