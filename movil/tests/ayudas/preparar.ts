// Preparación común de las pruebas: los márgenes del sistema (barra de estado, barra de gestos) no existen sin un
// dispositivo, así que se usa el mock oficial de react-native-safe-area-context. Una prueba puede cambiar los
// márgenes con `jest.mocked(useSafeAreaInsets).mockReturnValue(...)`.
jest.mock('react-native-safe-area-context', () => {
  const mock = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return { ...mock, useSafeAreaInsets: jest.fn(mock.useSafeAreaInsets) };
});
