// Package cuenta tiene los casos de uso de la cuenta (E12 `CuentaServicio` y `CuentaHandler`) y la regla de las
// finalidades que cada etapa del titular debe autorizar (D-139).
package cuenta

import "slices"

// Etapa es la etapa del titular de los datos: el valor de `persona.etapa`.
type Etapa string

const (
	EtapaAdulta Etapa = "adulta"
	EtapaMenor  Etapa = "menor"
)

// QuienOtorga dice quién da la autorización de una finalidad necesaria (E12 `QuienOtorga`).
type QuienOtorga int

const (
	// LaPersona: la autoriza el propio titular (adulto, PN-64, y a los 18 años, PN-54).
	LaPersona QuienOtorga = iota + 1
	// ElTutor: la autoriza el tutor del titular menor (PN-36).
	ElTutor
)

// Finalidades necesarias del catálogo de `0002_catalogo.sql`. Los códigos son los de la tabla `finalidad`.
const (
	CuentaYAcceso        = "cuenta_y_acceso"
	FuncionesFinancieras = "funciones_financieras"
	CuentaDelMenor       = "cuenta_del_menor"
)

// Finalidades accesorias activas que PN-64 le ofrece a una persona adulta (D-139).
const (
	Avisos      = "avisos"
	HorasDeVida = "horas_de_vida"
)

// FinalidadNecesaria es una finalidad que la etapa del titular debe tener autorizada, y quién la otorga.
type FinalidadNecesaria struct {
	Codigo string
	Otorga QuienOtorga
}

// Otorgamiento es una autorización vigente (`retirada_en` nula) de un titular: de qué finalidad y quién la dio.
type Otorgamiento struct {
	Finalidad   string
	OtorganteID string
}

// ReglaDeFinalidades fija, en un solo lugar, qué finalidades necesarias le tocan al titular según su etapa y quién
// las otorga (E12 `ReglaDeFinalidades`, D-139). Es una regla sin estado y sin base de datos: quien la usa le entrega
// los datos. Nada más del código debe repetir esta lista.
//
//   - Titular adulto: `cuenta_y_acceso` y `funciones_financieras`, otorgadas por él mismo (PN-64).
//   - Titular menor: `cuenta_del_menor`, otorgada por su tutor (PN-36).
//   - A los 18 años la persona pasa a `adulta` y vuelve a la lista de adulto, otorgada por ella (PN-54), sin
//     `cuenta_del_menor`.
//
// Las accesorias (`avisos`, `horas_de_vida`, `correo_del_menor`) y las inactivas (`transferencia`) no entran. La
// prueba guardiana `TestElCatalogoNoTieneNecesariasSinClasificar` falla si el catálogo de la migración tiene una
// finalidad necesaria y activa que esta regla no clasifica.
type ReglaDeFinalidades struct{}

var (
	necesariasDelAdulto = []FinalidadNecesaria{{CuentaYAcceso, LaPersona}, {FuncionesFinancieras, LaPersona}}
	necesariasDelMenor  = []FinalidadNecesaria{{CuentaDelMenor, ElTutor}}
	// accesoriasDelAdulto son las que PN-64 ofrece. Quedan fuera `correo_del_menor` (es del menor, I11) y
	// `transferencia` (inactiva, NM-06).
	accesoriasDelAdulto = []string{Avisos, HorasDeVida}
)

// Accesorias devuelve los códigos de las finalidades accesorias que se le ofrecen a la etapa: para la adulta,
// `avisos` y `horas_de_vida`; nada para las demás. Sirve a PN-64 (US-50): lo que no está aquí no se puede autorizar.
func (ReglaDeFinalidades) Accesorias(e Etapa) []string {
	if e == EtapaAdulta {
		return slices.Clone(accesoriasDelAdulto)
	}
	return nil
}

// Necesarias devuelve las finalidades necesarias de la etapa, o nada si la etapa no se conoce (ante la duda, quien
// llama no da por autorizada a nadie: ver Cumple).
func (ReglaDeFinalidades) Necesarias(e Etapa) []FinalidadNecesaria {
	switch e {
	case EtapaAdulta:
		return slices.Clone(necesariasDelAdulto)
	case EtapaMenor:
		return slices.Clone(necesariasDelMenor)
	}
	return nil
}

// Codigos devuelve solo los códigos de las necesarias de la etapa, en el orden de la regla.
func (r ReglaDeFinalidades) Codigos(e Etapa) []string {
	var codigos []string
	for _, f := range r.Necesarias(e) {
		codigos = append(codigos, f.Codigo)
	}
	return codigos
}

// Clasificada dice si la regla sabe qué hacer con la finalidad en alguna etapa.
func (ReglaDeFinalidades) Clasificada(codigo string) bool {
	return slices.ContainsFunc(slices.Concat(necesariasDelAdulto, necesariasDelMenor), func(f FinalidadNecesaria) bool {
		return f.Codigo == codigo
	})
}

// Cumple dice si el titular tiene autorizadas, de la forma que la regla exige, todas las finalidades necesarias de su
// etapa. vigentes son sus autorizaciones sin retirar y tutores los uuid de sus tutores actuales (vacío si es adulto).
// Una etapa desconocida no cumple. Para cada finalidad hace falta una autorización vigente dada por quien la regla
// dice: el propio titular, o uno de sus tutores.
func (r ReglaDeFinalidades) Cumple(etapa Etapa, titular string, vigentes []Otorgamiento, tutores []string) bool {
	necesarias := r.Necesarias(etapa)
	if len(necesarias) == 0 || titular == "" {
		return false
	}
	for _, f := range necesarias {
		dada := slices.ContainsFunc(vigentes, func(o Otorgamiento) bool {
			if o.Finalidad != f.Codigo {
				return false
			}
			if f.Otorga == LaPersona {
				return o.OtorganteID == titular
			}
			return slices.Contains(tutores, o.OtorganteID)
		})
		if !dada {
			return false
		}
	}
	return true
}
