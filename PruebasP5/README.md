


## CODIGO ARDUINO: este es el código que se usa para ArduinoIDE



```cpp
// ================= MODO DE PRUEBA =================
// Para enviar un valor fijo y probar la visual, cambia `USE_TEST_MODE` a `true`.
// Para usar el sensor real, ponerlo en `false`.
const bool USE_TEST_MODE = false;
const float TEST_PH_VALUE = 7.00; // El valor fijo que se enviará en modo de prueba.

float calibration_value = 21.34;   // calibración por si se destroncha

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

  // acortar el código a 10 muestras nada más
  for (int i = 0; i < 10; i++) {
    buffer_arr[i] = analogRead(A0);
    delay(30);
  }

  // rescript para ignorar los más ruidosos 
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

  // línea numerica simple para q no de lata la web
  Serial.println(ph_act, 2);

  delay(100);
}
```
