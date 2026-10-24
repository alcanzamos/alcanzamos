import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { textos } from '../textos/es.generated';
import { tokens } from '../tokens/tokens.generated';
import { CampoDeTexto, type PropiedadesDeCampo } from './CampoDeTexto';
import { IconoOcultar, IconoVer } from './Iconos';

// Campo de contraseña de E14-SDD 5.18: puntos, con el botón Ver y Ocultar (caja de 48 dp, nombre accesible
// «Mostrar la contraseña» u «Ocultar la contraseña»). Permite pegar: no se oculta el menú del campo ni se intercepta
// el pegado, para que un gestor de contraseñas funcione. Al salir de la pantalla vuelve a Oculta (el estado es local).
// `autocompletar`: `current-password` para la que ya existe y `new-password` para la nueva.
export function CampoDeContrasena(propiedades: PropiedadesDeCampo) {
  const [visible, setVisible] = useState(false);
  return (
    <CampoDeTexto
      {...propiedades}
      textoSeguro={!visible}
      accion={
        // E14-SDD 5.18 fija solo el nombre del botón, no una pista.
        // eslint-disable-next-line react-native-a11y/has-accessibility-hint
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? textos.campos.contrasena.ocultar : textos.campos.contrasena.mostrar}
          onPress={() => setVisible(!visible)}
          style={({ pressed }) => [
            estilos.ver,
            pressed && { backgroundColor: tokens.color.accion.secundaria['fondo-presionado'] },
          ]}
        >
          {visible ? (
            <IconoOcultar color={tokens.color.texto.secundario} />
          ) : (
            <IconoVer color={tokens.color.texto.secundario} />
          )}
        </Pressable>
      }
    />
  );
}

const estilos = StyleSheet.create({
  ver: {
    width: tokens.tamano['tactil-minimo'],
    height: tokens.tamano['tactil-minimo'],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radio.pequeno,
  },
});
