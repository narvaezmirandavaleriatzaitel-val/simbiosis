# Visual de pH con Puntos 3D


## Paso 1:  (Arduino)

Necesitas decirle a tu Arduino cómo leer el sensor de pH.

1.  Abre el **IDE de Arduino**.
2.  Copia y pega el siguiente código en un sketch nuevo.
3.  Conecta tu Arduino con el sensor de pH al computador.
4.  Sube el código a tu placa.

```cpp
// ================= MODO DE PRUEBA =================
// Para enviar un valor fijo y probar la visual, cambia `USE_TEST_MODE` a `true`.
// Para usar el sensor real, déjalo en `false`.
const bool USE_TEST_MODE = false;
const float TEST_PH_VALUE = 7.00; // El valor fijo que se enviará en modo de prueba.

float calibration_value = 21.34;   // Tu valor de calibración original.

int phval = 0;
unsigned long int avgval;
int buffer_arr[10], temp;
float ph_act;

void setup() {
  Serial.begin(9600);
}

void loop() {
  // Si el modo de prueba está activado, solo envía el valor fijo y espera.
  if (USE_TEST_MODE) {
    Serial.println(TEST_PH_VALUE, 2);
    delay(100);
    return; // No ejecuta el resto del código.
  }

  // Lee 10 muestras del sensor.
  for (int i = 0; i < 10; i++) {
    buffer_arr[i] = analogRead(A0);
    delay(30);
  }

  // Ordena las muestras para ignorar los valores más ruidosos.
  for (int i = 0; i < 9; i++) {
    for (int j = i + 1; j < 10; j++) {
      if (buffer_arr[i] > buffer_arr[j]) {
        temp = buffer_arr[i];
        buffer_arr[i] = buffer_arr[j];
        buffer_arr[j] = temp;
      }
    }
  }

  avgval = 0;
  for (int i = 2; i < 8; i++) {
    avgval += buffer_arr[i];
  }

  float volt = (float)avgval * 5.0 / 1024.0 / 6.0;
  ph_act = -5.70 * volt + calibration_value;

  // Envía una línea numérica simple como 7.14 para que la web la lea.
  Serial.println(ph_act, 2);

  delay(100);
}
```

**Importante**: Cierra el Monitor Serial del IDE de Arduino después de subir el código. Si no, el navegador no podrá conectarse.

## Paso 2: 

1.  Abre la carpeta de este proyecto en **Visual Studio Code**.
2.  Haz clic derecho sobre el archivo `index.html`.
3.  Selecciona `Open with Live Server`.
4.  Se abrirá una pestaña en tu navegador (Chrome o Edge).

## Paso 3: 

1.  Una vez en la página, **haz clic en cualquier lugar**.
2.  El navegador te pedirá permiso para usar la **cámara**. Acéptalo.
3.  Luego, te pedirá permiso para conectarse a un **puerto serial**. Elige el puerto donde está tu Arduino y haz clic en "Conectar".


## Notas

- **Navegadores**: Esto funciona mejor en `Chrome` y `Edge`.
- **Cambiar de pecera**: No necesitas hacer nada. Solo mueve el sensor de un líquido a otro y la visual reaccionará sola.
