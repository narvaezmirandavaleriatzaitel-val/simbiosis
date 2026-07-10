const bool USE_TEST_MODE = true;
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

  // Read 10 samples from the sensor.
  for (int i = 0; i < 10; i++) {
    buffer_arr[i] = analogRead(A0);
    delay(30);
  }

  // Sort the samples so we can ignore the noisiest values.
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

  // Send a plain numeric line like 7.14 for the p5.js sketch.
  Serial.println(ph_act, 2);

  delay(100);
}
