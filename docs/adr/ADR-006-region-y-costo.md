# ADR-006 · Región de Azure y costo recalculado

> **Copia pública del ADR; el original vive en el repositorio privado del proyecto.** Los identificadores `D-nnn` (decisiones), `E11-xxx`, `E14-xxx`, `ERS`, `RF/RNF/RN/RE/RT-nnn`, `O-n`, `P-nn`, `NM-nn` y `US-nn` remiten al registro de decisiones y a documentos de ese repositorio; se conservan como trazabilidad y no tienen enlace.

| Campo | Valor |
|---|---|
| Documento | Registro de decisión arquitectónica 006 · Código: E11-ADR-006 |
| Proyecto | Alcanzamos |
| Estado | **Aprobado por el dueño (D-080): México Central y API de 0,25 vCPU y 0,5 GiB.** Las tareas programadas, el costo después de abril de 2027 y la versión nueva de E02 se definen después |
| Versión | 1.1 |
| Autor | Andrés Jiménez |
| Responsable de decidir | Dueño del proyecto |
| Uso de IA | El asistente consultó los precios y la disponibilidad, calculó el costo y redactó la propuesta; el dueño revisa y decide (D-051). |

## Control de versiones

| Versión | Fecha | Descripción del cambio | Autor |
|---|---|---|---|
| 0.1 | 2026-10-19 | Borrador: región por la regla de D-071, disponibilidad y precios del 2026-10-19, costo mensual recalculado con México Central y comparación con E02 | Andrés Jiménez |
| 0.2 | 2026-10-19 | Costo recalculado con las decisiones de D-076: API en Go, monolito modular (sin Service Bus), imágenes en GitHub (sin Container Registry), tres escenarios con el dimensionamiento del API en Go. Registro de proveedores aprobado por el dueño | Andrés Jiménez |
| 1.0 | 2026-10-19 | Aprobado por el dueño (D-080): México Central y dimensionamiento de 0,25 vCPU y 0,5 GiB, a confirmar con la medición de E17. Las preguntas 3 a 5 quedan para después. Se reafirma que el ambiente de desarrollo corre local, no en Azure | Andrés Jiménez |
| 1.1 | 2026-10-21 | D-108 (condición de H2, NC-E16-04): las secciones 2 y 4 dejan de decir «propuesta» donde el ADR está decidido (D-080). Sin cambio de contenido | Andrés Jiménez |

## 1. Contexto

- **D-071** fijó la regla: si gana D, A o B, la región es **México Central** (`mexicocentral`); si gana C, Francia Central. **D-075: gana D.** La rama que aplica es México.
- **D-049:** una política de la suscripción solo permite `francecentral`, `spaincentral`, `chilecentral`, `switzerlandnorth` y `mexicocentral` [P].
- **P-11** (nivel adecuado según la SIC, Ley 1581 art. 26) la verificó E11-CYR §4 con el texto oficial de la Circular Externa 005 de 2017 [P].
- **E11-CYR 7.2** dejó una lista para este ADR. Este documento responde a los puntos 1, 5 y 7, y deja los demás en la sección 8.
- **D-076 (2026-10-19)** cambia el costo: el API va en **Go** (ADR-002); el estilo es un **monolito modular** en vez de la cola y los trabajadores de D-026 (**D-076 modifica D-026**); las **imágenes van en GitHub Container Registry**, no en Azure Container Registry; y el dueño **aprobó el registro de proveedores de recursos de Azure**, que se hace al crear los recursos (E17).
- **Sin IA.** D gana: no hay proveedor de IA. **La línea de Azure OpenAI de E02 desaparece**, y con ella R-F4 (el modelo de IA no existe en México, pero ya no importa) [P].

**Lo que este ADR no hace.** No crea recursos, no registra proveedores y no toca la suscripción. Todas las consultas del 2026-10-19 son de solo lectura.

## 2. Alternativas

| # | Alternativa | Razón de descarte o de elección |
|---|---|---|
| A | **México Central** (`mexicocentral`, Querétaro) | **Decidida (D-080).** Regla de D-071. Figura por nombre en la lista de la SIC. Es la más barata y la más cercana a Colombia |
| B | Francia Central (`francecentral`) | Pasa los filtros. Era la región si ganaba C. Pierde en costo y en distancia |
| C | España Central (`spaincentral`) | Pasa los filtros. Pierde en costo y en distancia. Sin región pareada |
| D | Suiza Norte (`switzerlandnorth`) | Solo entra a la lista de la SIC por la cláusula de la Comisión Europea, lectura sin confirmar |
| E | Chile Central (`chilecentral`) | **Eliminada por R-F5:** no figura en la lista de la SIC ni en las decisiones de adecuación de la Comisión Europea |

## 3. Filtros y puntajes de región (E11-CYR §3)

La región se evalúa con los criterios de región de E11-CYR §3, no con AC-1 a AC-8: esos pesos describen la arquitectura y no distinguen regiones, salvo el costo, que ya entra en R-2.

### 3.1 Filtros

| Filtro | México | Francia | España | Suiza | Chile |
|---|---|---|---|---|---|
| R-F1 Política de la suscripción | Sí (D-049) | Sí | Sí | Sí | Sí |
| R-F2 PostgreSQL B1ms | **Sí, hoy** [M]: nivel Burstable, `Standard_B1ms`, 1 vCore, sin `reason` ni restricción; versiones 11 a 18 | Sí (E11-CYR EV-1, 2026-10-17) | Sí (ídem) | Sí (ídem) | Sí (ídem) |
| R-F3 Tipos de recurso de D-029 y D-026 | **Sí, hoy** [M]: Container Apps, Key Vault y PostgreSQL listan «Mexico Central». Service Bus y Container Registry también, pero **ya no se usan** (D-076) | Sí (E11-CYR EV-4) | Sí | Sí | Sí |
| R-F4 Modelo de IA | **Ya no elimina** (D gana, D-075) | — | — | — | — |
| R-F5 P-11 | **Sí, por nombre** | Sí, por nombre | Sí, por nombre | Sí, solo por la cláusula | **No** |
| **Pasa** | **Sí** | Sí | Sí | Sí | No (R-F5) |

**P-11 para México.** La Circular Externa 005 de 2017 de la SIC, numeral 3.2, nombra a México entre los países que garantizan un nivel adecuado: «… Luxemburgo; Malta; **México**; Noruega; Países Bajos …». Fuente y verificación en E11-CYR §4.2 (consultada el 2026-10-17; SHA-256 del PDF `a0df89e6…f107`) [P]. **No se volvió a leer la lista de la SIC hoy** (sección 8).

**Disponibilidad de SKU, hoy.** El filtro R-F3 de E11-CYR comprobaba el tipo de recurso, no el SKU (E11-CYR 6.4). Hoy la API de precios devuelve medidores en `mexicocentral` para los SKU concretos: PostgreSQL B1ms, Container Apps de consumo y Key Vault Standard [M, API de precios, 2026-10-19]. También devolvió Service Bus Basic y Container Registry Basic, que con D-076 ya no se usan. Es un indicio fuerte de que se ofrecen, **no una garantía de que la suscripción de estudiante pueda crearlos** (sección 7).

### 3.2 Puntajes (pesos de E11-CYR 3.2: R-1 50 %, R-2 30 %, R-3 20 %)

| Dato | México | Francia | España | Suiza |
|---|---|---|---|---|
| Cómputo B1ms, USD por hora [M, API de precios, 2026-10-19] | 0,0187 | 0,019 | 0,0199 | 0,02189 |
| Cómputo B1ms, USD por mes (× 730 h) | 13,65 | 13,87 | 14,53 | 15,98 |
| Almacenamiento PostgreSQL, USD por GB al mes [M] | 0,1265 | 0,133 | 0,1369 | 0,15059 |
| Cómputo y 32 GB, USD por mes (informativo) | 17,70 | 18,13 | 18,91 | 20,80 |
| Distancia desde Bogotá, km (cálculo propio de E11-CYR 5.3, no repetido hoy) | 3.347 | 8.590 | 8.035 | 9.068 |
| R-1 Solidez de P-11 | 100 | 100 | 100 | 50 |
| R-2 Costo (100 × menor precio ÷ precio) | 100 | 98,4 | 94,0 | 85,4 |
| R-3 Latencia (100 × menor distancia ÷ distancia) | 100 | 39,0 | 41,7 | 36,9 |
| **Puntaje ponderado** | **100** | **87,3** | **86,5** | **58,0** |

Los precios por hora coinciden con los de E11-CYR 5.3 (2026-10-17): no cambiaron. El costo de almacenamiento no entra en R-2 porque E11-CYR lo definió solo con el cómputo; se muestra aparte y no cambia el orden. La latencia real no se midió: la distancia es un cálculo.

## 4. Decisión (D-080)

**México Central (`mexicocentral`).**

1. Aplica la regla de D-071 con el resultado de US-21 (D gana, D-075).
2. Puntúa 100 contra 87,3 de Francia: México es el primero en los tres criterios.
3. México figura por nombre en la lista de la SIC (P-11).

### Transferencia o transmisión

Verificado en **E11-TDE** (estudio de transmisión de datos, 2026-10-19). Resumen:

- El Decreto 1377 de 2013, arts. 24 y 25 (Decreto 1074 de 2015, arts. 2.2.2.25.5.1 y 2.2.2.25.5.2), distingue la **transferencia** (a otro responsable; art. 26 de la Ley 1581) de la **transmisión** (a un encargado que trata por cuenta del responsable). La transmisión internacional no requiere informar al titular ni su consentimiento **si existe un contrato de transmisión** con el contenido del art. 25.
- El contrato de protección de datos de Microsoft (DPA, 22 de mayo de 2026) declara a Microsoft **encargado** («processor») que trata solo por instrucciones. Cubre alcances, seguridad y confidencialidad; cubre en parte lo que depende de la ley colombiana; no menciona la política de tratamiento del responsable. Para sus «business operations», Microsoft es responsable independiente.
- **Lectura, no asesoría jurídica:** guardar los datos en Azure encaja como transmisión a un encargado. Si el DPA basta como contrato del art. 25, es un juicio jurídico: es una de las preguntas de la revisión jurídica (E11-EIP, decisión 3).
- **Para la región no cambia nada:** con México nombrado en la lista de la SIC (CE 005 de 2017), las dos figuras llevan al mismo resultado práctico. El DPA también permite que Microsoft trate datos en los Estados Unidos y en los países de sus subencargados; los Estados Unidos están nombrados en la misma lista. Los demás países posibles no se verificaron.
- **No verificado:** si el DPA aplica a la oferta Azure for Students (E11-TDE, 3.1 y 7).

## 5. Costo mensual recalculado con precios de México Central

### 5.1 Método y fuente

- **Fuente de precios:** API pública de precios de Azure, `https://prices.azure.com/api/retail/prices`, `api-version=2023-01-01-preview`, filtro `armRegionName eq 'mexicocentral'` más `serviceName` y `skuName`. Consultada el 2026-10-19. Precio de lista en USD, sin descuentos ni impuestos [M]. Los precios de PostgreSQL, Key Vault y Container Apps ya estaban en la versión 0.1; **se volvió a consultar Container Apps** para separar las tarifas activa y en reposo.
- **Horizonte:** 3 meses con Azure en uso (febrero a abril de 2027), como en E02 [P]. El ambiente dev corre en local (D-031), sin costo en Azure.
- **Usuarios:** 20 personas de prueba, como E02 [P].
- **Cantidades:** son supuestos del asistente [S] y se declaran en cada renglón. La franja gratuita de Container Apps (180.000 vCPU-s, 360.000 GiB-s y 2 millones de solicitudes por mes y suscripción) sale de la documentación de Microsoft [F, `learn.microsoft.com/en-us/azure/container-apps/billing`, 2026-10-19].
- **Arquitectura que se cuesta (D-076):** **un contenedor del API en Go** (monolito modular, con la web estática embebida según la propuesta de ADR-004) y **un trabajo programado** con la misma imagen para las tareas. **Sin Service Bus, sin trabajadores aparte y sin registro de contenedores de pago.** Las imágenes van en GitHub (sección 5.2, renglón 6). Sin IA (D-075).
- **Tarifas de Container Apps (consumo), México Central [M]:**

| Medidor | USD |
|---|---|
| vCPU activo | 0,000026 por vCPU-s |
| vCPU en reposo | 0,000003 por vCPU-s |
| Memoria, activa o en reposo | 0,000003 por GiB-s |
| Solicitudes | 0,44 por millón (los primeros 2 millones son gratis) |

- **Reglas de facturación que importan [F, billing]:** con réplicas en cero no hay cobro. Una réplica con mínimo mayor que cero está «en reposo» solo si no atiende solicitudes, usa menos de 0,01 vCPU y recibe menos de 1.000 bytes por segundo; si no, paga la tarifa activa. **Los trabajos pagan siempre la tarifa activa** y solo mientras corren.

### 5.2 Renglones (escenario base)

| # | Renglón | Cantidad supuesta | Precio unitario (USD) | USD al mes | Notas |
|---|---|---|---|---|---|
| 1 | PostgreSQL B1ms, cómputo [M] | 730 h | 0,0187 por hora | **13,65** | |
| 2 | PostgreSQL, almacenamiento [M] | 32 GiB (el mínimo que ofrece la región [M]) | 0,1265 por GB al mes | **4,05** | Con 64 GiB serían 8,10 |
| 3 | PostgreSQL, copias de seguridad | Hasta el 100 % del almacenamiento aprovisionado, sin costo [F, `learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore`] | 0,1045 por GB al mes si se excede [M] | **0,00** | Se supone que las copias caben en 32 GiB [S] |
| 4 | Container Apps: API (0,25 vCPU y 0,5 GiB, **mínimo 1 réplica**) y trabajo programado | API: 657.000 vCPU-s y 1.314.000 GiB-s al mes, con **5 % del tiempo activo** [S] (32.850 vCPU-s activos). Trabajo: cada 15 minutos, 20 segundos, 0,25 vCPU y 0,5 GiB [S]: 2.920 ejecuciones, 14.600 vCPU-s y 29.200 GiB-s. Total: 624.150 vCPU-s en reposo, 47.450 vCPU-s activos y 1.343.200 GiB-s | Ver 5.1 | **5,52** | Bruto 7,14 (1,87 + 1,23 + 4,03) menos 1,62 de franja gratuita. La franja se restó a la tarifa **más baja** (0,000003), el supuesto que menos ahorra. **No verificado** a qué segundos se aplica la franja. Solicitudes: 100.000 al mes, bajo los 2 millones gratuitos: 0 |
| 5 | Key Vault Standard [M] | 100.000 operaciones | 0,033 por 10.000 | **0,33** | |
| 6 | Imágenes de contenedor en **GitHub Container Registry** | Una imagen del API, pública con el código (D-036) | — | **0,00** | El uso de GitHub Packages es gratuito para paquetes públicos [F, `docs.github.com`, «Billing for GitHub Packages»]. Hoy el almacenamiento y el ancho de banda del registro de contenedores son gratuitos y GitHub avisaría con un mes de anticipación si cambia [F, mismo texto]. **Se quitaron** las líneas de Container Registry Basic (USD 5,07 y 0,20 al mes de la versión 0.1) |
| 7 | Salida de datos a Internet [M] | 5 GB | 0 hasta 100 GB; luego 0,08 por GB | **0,00** | |
| 8 | Log Analytics, ingestión [M] | 1 GB | 0 hasta 5 GB; luego 2,53 por GB | **0,00** | Monitoreo sin decidir (D-029) |
| 9 | **Service Bus Basic** | — | — | **0,00** | **Desaparece (D-076):** sin trabajadores aparte. Eran USD 0,02 al mes |
| 10 | **Azure OpenAI** | — | — | **0,00** | **Desaparece: D gana (D-075)** |
| | **Total mensual, escenario base** | | | **23,55** | |
| | **Total de 3 meses** | | | **70,6** | |

Suma: 13,651 + 4,048 + 5,516 + 0,33 = 23,545.

**No incluido, no verificado:**

- **Servicio de correo** (verificación de cuenta y recuperación, ERS §3.1): el proveedor no está elegido [P]. Su precio **no verificado**.
- **Notificaciones (FCM) y Web Push:** E02 los marcó gratis [P]. **No verificado hoy.**
- **Impuestos:** la API da precio de lista sin impuestos. **No verificado** cómo cuenta el crédito de estudiante.
- **Google Play:** USD 25 una sola vez, fuera del crédito [P, E02-EDC §3].
- **Imágenes privadas en GitHub.** Si el dueño prefiere una imagen privada, aplican las cuotas de GitHub Packages (500 MB en el plan gratuito de organización [F, misma página]); no se verificó si caben.

### 5.3 Tres escenarios

Lo que más se mueve es Container Apps. Los renglones 1, 2, 5 y 6 no cambian (USD 18,03 al mes). Se muestran tres casos:

| Escenario | Qué supone | Container Apps, USD al mes | Total al mes | Total de 3 meses | Meses que alcanza el crédito | AC-1 (lectura del README) | AF-2 |
|---|---|---|---|---|---|---|---|
| **Bajo** | API con réplica en cero: activa 4 horas al día (109.500 vCPU-s) más el trabajo | 2,35 | 20,38 | **61,1** | 4,9 | 4 | Pasa |
| **Base** | API 0,25 vCPU y 0,5 GiB, siempre encendida, 5 % activa, más el trabajo | 5,52 | 23,55 | **70,6** | 4,2 | 4 | Pasa |
| **Alto** | API **0,5 vCPU y 1 GiB** siempre encendida, 15 % activa (el triple de uso y el doble de recursos), más el trabajo | 15,21 | 33,24 | **99,7** | 3,0 | 2 | **Pasa por USD 0,3** |

**Escenario alto.** Roza el crédito. Si la franja gratuita no se aplicara como se supuso, el total de 3 meses sería **104,6 y AF-2 fallaría** (tabla siguiente). Es un caso de estrés, no el esperado: parte de dos veces la memoria y la CPU propuestas y de tres veces el uso del base.

Variantes (mismos renglones, cambia uno):

| Variante | Total al mes | Total de 3 meses |
|---|---|---|
| Base sin franja gratuita | 25,16 | 75,5 |
| Alto sin franja gratuita | 34,86 | **104,6** (no pasa) |
| **Alto con la réplica en cero** (0,5 vCPU y 1 GiB, 4 horas activas al día): la salida si Go necesitara más recursos | 23,88 | 71,7 |
| Base con la web en un contenedor aparte (0,25 vCPU y 0,5 GiB, réplica en cero, 2 horas al día) | 25,30 | 75,9 |
| Base con 64 GiB de base de datos (+4,05 al mes) | 27,59 | 82,8 |
| Alto con 64 GiB de base de datos | 37,28 | 111,9 (no pasa) |

### 5.4 Dimensionamiento del contenedor del API: 0,25 vCPU y 0,5 GiB

**Propuesta: aceptar 0,25 vCPU y 0,5 GiB como punto de partida; no se rechaza.** La razón está en ADR-002 §6.2: un presupuesto de memoria **estimado, sin medir**, de unos 190 MiB en el peor caso (entorno de ejecución de Go, pool de PostgreSQL, hasta 4 verificaciones de Argon2id de 19 MiB a la vez y solicitudes en curso), con `GOMEMLIMIT` en unos 400 MiB [F, `go.dev/doc/gc-guide`]. El dueño esperaba que cupiera en 0,25 vCPU y 0,5 GiB (L3); la estimación lo respalda.

- **Lo que no se midió:** memoria real en reposo y con 20 personas, tiempo de Argon2id con 0,25 vCPU y arranque en frío. Se mide en E17 base (ADR-002 §6.2).
- **Qué hacer si no cabe:** pasar a 0,5 vCPU y 1 GiB con **réplica en cero** (variante de 71,7 en 3 meses), o subir y mantener encendida si RNF-001 lo exige (escenario alto, 99,7).
- **Réplica mínima 1 o en cero.** El escenario base la mantiene encendida para que el registro no pague un arranque en frío (RNF-001); eso **no se midió**. El bajo la deja en cero y ahorra USD 3,2 al mes.

### 5.5 Tareas programadas: trabajo de Container Apps (propuesta)

Las tareas (faltantes, transiciones de edad, borrados a 30 y 60 días, vencimientos de 7 días) corren como un **trabajo programado de Container Apps con la misma imagen** y otro comando (`alcanzamos tareas`). Razones en ADR-002 §5.4. Efecto en costo: el trabajo paga la tarifa activa solo mientras corre [F, billing]; con 20 segundos cada 15 minutos son USD 0,47 al mes antes de la franja [calculado: 14.600 × 0,000026 + 29.200 × 0,000003]. Las expresiones cron de los trabajos se evalúan en UTC [F, `learn.microsoft.com/en-us/azure/container-apps/jobs`]. El proveedor es el mismo (`Microsoft.App`).

### 5.6 Comparación con E02 y con el crédito

| | USD al mes | USD en 3 meses | Fuente |
|---|---|---|---|
| E02, opción B, con IA (`eastus`) | 31,1 (16,1 fijo + 0,75 × 20 de IA) | **≈ 93** | E02-EDC §3 |
| E02, sin la línea de IA | 16,09 | 48,3 | E02-EDC §3, línea de IA quitada |
| Versión 0.1 de este ADR (Java, Service Bus, registro de pago), base | 27,61 | 82,8 | ADR-006 v0.1 |
| **Este cálculo, escenario base (Go, monolito, imágenes en GitHub, México Central)** | **23,55** | **70,6** | Sección 5.2 |
| Crédito de Azure for Students | — | **100** | documento interno de configuración de Azure (§2) |

**Lectura.**

1. **Menos que la versión 0.1 y que E02 con IA, pero más que E02 sin IA.** Frente a la versión 0.1 bajan USD 4,06 al mes: sin Container Registry (−5,27) ni Service Bus (−0,02); con Container Apps un poco más caro (+1,23) por separar la tarifa activa.
2. **De dónde salen los USD 7,46 al mes de diferencia con los 16,09 de E02 sin IA:**

| Concepto | USD al mes |
|---|---|
| Cómputo de PostgreSQL: México (0,0187) frente a `eastus` (0,017) | + 1,24 |
| Almacenamiento: 0,1265 frente a 0,115 por GB | + 0,37 |
| Container Apps, escenario base | + 5,52 |
| Key Vault | + 0,33 |
| **Total** | **+ 7,46** |

3. **Con los supuestos de E02 (Container Apps y Key Vault en cero), el efecto de la región es de USD 1,61 al mes** (13,65 + 4,05 = 17,70 frente a 16,09), unos USD 4,8 en 3 meses. México es la más barata de las cinco regiones.
4. **Frente al crédito.** El escenario base deja un margen de USD 29,4 sobre 3 meses. Las alertas de USD 50, 75 y 90 llegan en los meses 2,1, 3,2 y 3,8 [calculado].
5. **El crédito alcanza para unos 4,2 meses** en el escenario base (100 ÷ 23,55). Si el producto sigue en Azure de febrero a septiembre de 2027 (hasta el fin del crédito, ≈ 2027-09-28), serían unos 8 meses: USD 188. E02 ya decía que después de graduarse el costo lo mantiene el dueño o un financiamiento aplazado (SC-01) [P]. La estimación de sostenibilidad de E02 §4 (USD 16,1 al mes más IA) queda desactualizada: sin IA y con estos precios, el mes de operación es USD 23,5 en el escenario base.

**E02 no se editó aquí.** Si el dueño aprueba estas cifras, E02-EDC necesita una versión nueva.

## 6. Consecuencias

**Lo que se gana**

- Región por nombre en la lista de la SIC, la más barata y la más cercana (piso de 33 ms de ida y vuelta, cálculo propio, no medido).
- Las copias de seguridad **no salen de la región**: `geoBackupSupported` figura «Disabled» en México Central [M, `az postgres flexible-server list-skus`, 2026-10-19]. Eso cumple la condición C de E11-EIP 6.3 («las copias de seguridad no salen de ella»).

**Lo que se pierde o queda condicionado**

- **Sin copia geográfica ni región pareada.** E11-CYR 5.3 ya registraba que México no tiene región pareada. Si se pierde la región, se pierden los datos y sus copias. La ERS no tiene un requisito de disponibilidad ni de recuperación [P, ERS v1.9, revisada]. Se acepta para la versión de grado y se anota como riesgo.
- **Sin modelo de IA en la región.** Irrelevante con D. Si en el futuro se agrega un proveedor de IA, se reabre la región (RNF-008).
- **El costo es una estimación con supuestos sin medir.** El escenario alto toca el crédito (USD 99,7 de 100; 104,6 si la franja gratuita no se aplica como se supuso).
- **Imágenes en GitHub:** el registro de contenedores de GitHub hoy es gratuito, pero GitHub se reserva cambiar esa política con un mes de aviso [F, `docs.github.com`, «Billing for GitHub Packages»]. Si cambia, se vuelve a Azure Container Registry (USD 5,27 al mes) o a otro registro (RNF-008).
- **Un solo contenedor del API.** Una falla del API afecta a todos los módulos. Se acepta por AF-4 (una persona) y se mitiga con pruebas y despliegues pequeños.
- **E02 queda desactualizada** en operación y en sostenibilidad (sección 5.6).

## 7. Sensibilidad (E11-CYR 2.3)

**Región.** México puntúa 100: es el primero en R-1 (empata con Francia y España), en R-2 y en R-3. Como no pierde en ningún criterio, ningún cambio de pesos lo baja del primer lugar. Con pesos de 50, 20 y 30 para R-1, R-2 y R-3 (la variante de E11-CYR 5.4), México sigue en 100 y Francia queda en 81,4. **Robusto.**

**Costo.** Los tres escenarios de 5.3 son la sensibilidad. La decisión de región no cambia con ellos: ninguna otra región baja el costo. Lo que cambia es AF-2 (escenario alto, sin franja gratuita) y, con él, el dimensionamiento de ADR-002 §6.2. **Con 0,25 vCPU y 0,5 GiB hay margen de USD 29,4**; si Go exigiera el doble, la réplica en cero mantiene el total en USD 71,7.

**Riesgo de que la suscripción no permita crear los recursos.** `list-skus` muestra el SKU sin restricción, pero crear PostgreSQL B1ms en una suscripción de estudiante puede fallar por una restricción de oferta que la consulta no muestra [S]. Se sabe al crear el recurso (E17 base, I04).

## 8. Pendientes y preguntas para el dueño

**Para cerrar el ADR de región (lista de E11-CYR 7.2):**

| # | Punto | Estado |
|---|---|---|
| 1 | Decidir la región con la regla de D-071 | **Propuesta: México Central.** Decide el dueño |
| 2 | Volver a mirar la lista de la SIC (proyecto de 2026) y los textos de la CE 008 de 2017 y la CE 002 de 2018 | **Pendiente.** No se repitió hoy; el resultado para México no cambia con la lista de 2026 que conoce E11-CYR 4.3 |
| 3 | Tipo de despliegue del modelo | **No aplica** (D gana) |
| 4 | Cuota del modelo y registro de proveedores | Cuota: no aplica. **Proveedores sin registrar** [M, 2026-10-19]: `Microsoft.App`, `Microsoft.DBforPostgreSQL`, `Microsoft.ServiceBus`, `Microsoft.KeyVault`, `Microsoft.ContainerRegistry` y `Microsoft.OperationalInsights` figuran `NotRegistered`. **Registro aprobado por el dueño (D-076).** Se hace **cuando se creen los recursos, en E17**; todavía no se hizo ni se hará antes. Con D-076 ya no hacen falta `Microsoft.ServiceBus` ni `Microsoft.ContainerRegistry`: quedan cuatro (`Microsoft.App`, `Microsoft.DBforPostgreSQL`, `Microsoft.KeyVault`, `Microsoft.OperationalInsights`). Registrar los dos que sobran no se aprobó de forma expresa [S] |
| 5 | Recalcular E02-EDC | **Hecho** (sección 5). E02 sin editar |
| 6 | Recrear identidad, grupo y conexión de servicio con los nombres definitivos y borrar los de la prueba de región | **Pendiente.** El grupo de recursos de la prueba ya está en `mexicocentral` [P, documento interno de configuración de Azure]. No se tocó |
| 7 | Repetir el cálculo sin R-F4 | **Hecho** (sección 3) |
| 8 | `DataZoneStandard` si gana C | **No aplica** |
| 9 | Decreto 1377, arts. 24 y 25, y DPA de Microsoft | **Hecho:** E11-TDE, integrado en la sección 4. La conclusión jurídica queda para la revisión de la decisión 3 de E11-EIP |

**Decididas por el dueño en D-076:** registrar los proveedores en E17; imágenes en GitHub; monolito modular (sin Service Bus).

**Decididas por el dueño en D-080:** México Central (pregunta 1) y 0,25 vCPU y 0,5 GiB (pregunta 2). **El ambiente de desarrollo corre local, en Docker, nunca en Azure** (supuesto de E02-EDC aprobado con D-030; D-080 lo reafirma).

**Preguntas que quedan para después (D-080):**

1. ¿Aprueba México Central?
2. ¿Acepta el dimensionamiento de 0,25 vCPU y 0,5 GiB para el API, a confirmar con la medición de ADR-002 §6.2?
3. ¿Acepta el **trabajo programado de Container Apps** para las tareas (sección 5.5)?
4. ¿Acepta que el producto no quede en Azure más de ≈ 4,2 meses con el crédito, o abre ya la discusión de qué pasa después (SC-01)?

## Fuentes

D-029, D-049, D-062, D-071, D-075, D-076; ADR-002 y ADR-004; E11-CYR v1.1 §3 a §7; E11-EIP v1.2 §6; E02-EDC §3 y §4; documento interno de configuración de Azure (§2 a §4); API de precios de Azure (`prices.azure.com`), `az postgres flexible-server list-skus`, `az rest` sobre los proveedores de recursos y `az provider show`, todos de solo lectura y del 2026-10-19; documentación de Microsoft Learn sobre facturación y trabajos de Container Apps y copias de PostgreSQL, y de GitHub sobre la facturación de GitHub Packages, consultadas el 2026-10-19; `go.dev/doc/gc-guide`.
