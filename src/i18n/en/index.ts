// Diccionario español → inglés, repartido por temas (cada fichero es un objeto plano). Un texto nuevo va al fichero de
// su tema (o a uno nuevo con el nombre del tema), nunca a uno con el nombre de la ronda o de la tarea que lo añade.
import { accesibilidad } from "./accesibilidad";
import { acceso } from "./acceso";
import { admin } from "./admin";
import { almacenamiento } from "./almacenamiento";
import { baja } from "./baja";
import { board } from "./board";
import { calendar } from "./calendar";
import { campos } from "./campos";
import { carga } from "./carga";
import { colaboracion } from "./colaboracion";
import { comentarios } from "./comentarios";
import { common } from "./common";
import { conexion } from "./conexion";
import { copia } from "./copia";
import { datos } from "./datos";
import { cuentas } from "./cuentas";
import { detalle } from "./detalle";
import { documentacion } from "./documentacion";
import { ics } from "./ics";
import { importar } from "./importar";
import { instalar } from "./instalar";
import { landing } from "./landing";
import { legal } from "./legal";
import { licencia } from "./licencia";
import { lista } from "./lista";
import { mensajeria } from "./mensajeria";
import { pegado } from "./pegado";
import { plantillas } from "./plantillas";
import { proyectos } from "./proyectos";
import { releases } from "./releases";
import { repeticion } from "./repeticion";
import { server } from "./server";
import { settings } from "./settings";
import { setup } from "./setup";
import { soporte } from "./soporte";
import { task } from "./task";
import { textos } from "./textos";
import { web } from "./web";
import { wip } from "./wip";

// Ninguna clave se repite entre ficheros (`npm run i18n:unused` lo comprueba), así que el orden no cambia nada.
export const EN: Record<string, string> = {
  ...common, ...board, ...task, ...detalle, ...comentarios, ...lista, ...pegado, ...wip, ...calendar, ...releases, ...conexion,
  ...accesibilidad, ...settings, ...admin, ...server, ...cuentas, ...acceso, ...colaboracion, ...proyectos, ...plantillas,
  ...setup, ...documentacion, ...campos, ...almacenamiento, ...importar, ...ics, ...mensajeria, ...soporte, ...licencia,
  ...legal, ...landing, ...web, ...instalar, ...baja, ...datos, ...copia, ...repeticion, ...carga, ...textos,
};
