// Diccionario español → inglés, repartido por zonas de la app (cada fichero es un objeto plano).
import { acceso } from "./acceso";
import { admin } from "./admin";
import { almacenamiento } from "./almacenamiento";
import { board } from "./board";
import { colaboracion } from "./colaboracion";
import { calendar } from "./calendar";
import { campos } from "./campos";
import { common } from "./common";
import { cuentas } from "./cuentas";
import { documentacion } from "./documentacion";
import { ics } from "./ics";
import { importar } from "./importar";
import { proyectos } from "./proyectos";
import { server } from "./server";
import { settings } from "./settings";
import { landing } from "./landing";
import { lista } from "./lista";
import { legal } from "./legal";
import { licencia } from "./licencia";
import { licencia2 } from "./licencia2";
import { setup } from "./setup";
import { task } from "./task";
import { wip } from "./wip";

export const EN: Record<string, string> = { ...common, ...board, ...task, ...settings, ...admin, ...server, ...cuentas, ...colaboracion, ...proyectos, ...calendar, ...setup, ...documentacion, ...campos, ...legal, ...landing, ...almacenamiento, ...licencia, ...licencia2, ...wip, ...importar, ...ics, ...lista, ...acceso };
