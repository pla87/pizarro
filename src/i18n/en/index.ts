// Diccionario español → inglés, repartido por zonas de la app (cada fichero es un objeto plano).
import { admin } from "./admin";
import { board } from "./board";
import { colaboracion } from "./colaboracion";
import { calendar } from "./calendar";
import { campos } from "./campos";
import { common } from "./common";
import { cuentas } from "./cuentas";
import { documentacion } from "./documentacion";
import { proyectos } from "./proyectos";
import { server } from "./server";
import { settings } from "./settings";
import { legal } from "./legal";
import { setup } from "./setup";
import { task } from "./task";

export const EN: Record<string, string> = { ...common, ...board, ...task, ...settings, ...admin, ...server, ...cuentas, ...colaboracion, ...proyectos, ...calendar, ...setup, ...documentacion, ...campos, ...legal };
