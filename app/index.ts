import "react-native-url-polyfill/auto";
import { registerRootComponent } from "expo";
import "./src/lib/location"; // registers the 06:00–18:00 background location task
import App from "./src/App";

registerRootComponent(App);
