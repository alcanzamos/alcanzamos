import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { logoHorizontalColor } from '../../assets/marca/logoHorizontalColor';
import { tokens } from '../tokens/tokens.generated';

// Marca/Logo/Horizontal · color (E14-IDV 5.1), centrada y de 40 de alto (`espacio.10`) como en la web.
// El lector de pantalla lo lee como una imagen llamada «Alcanzamos».
export function Logo() {
  return (
    // Sin pista: es una imagen de marca y el nombre ya dice todo lo que hay que decir.
    // eslint-disable-next-line react-native-a11y/has-accessibility-hint
    <View accessible accessibilityRole="image" accessibilityLabel="Alcanzamos" importantForAccessibility="yes">
      <SvgXml xml={logoHorizontalColor} width="100%" height={tokens.espacio['10']} />
    </View>
  );
}
