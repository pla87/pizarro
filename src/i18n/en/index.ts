// Diccionario español → inglés, repartido por zonas de la app (cada fichero es un objeto plano).
import { admin } from "./admin";
import { board } from "./board";
import { common } from "./common";
import { cuentas } from "./cuentas";
import { server } from "./server";
import { settings } from "./settings";
import { task } from "./task";

export const EN: Record<string, string> = { ...common, ...board, ...task, ...settings, ...admin, ...server, ...cuentas };
