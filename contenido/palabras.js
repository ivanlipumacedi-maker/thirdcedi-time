// Pares de palabras de El Impostor: la mayoría recibe `palabra` y el impostor recibe `impostor`,
// una palabra parecida pero distinta, para que pueda disimular sin saber cuál es la de los demás.
(function (g) {
  const pares = [
    // Comida y bebida
    ['Choripán', 'Bondiola'], ['Mate', 'Tereré'], ['Asado', 'Parrillada'], ['Empanada', 'Calzone'],
    ['Milanesa', 'Suprema'], ['Alfajor', 'Conito'], ['Dulce de leche', 'Mermelada'], ['Medialuna', 'Vigilante'],
    ['Pizza', 'Fainá'], ['Fernet', 'Gancia'], ['Helado', 'Licuado'], ['Café', 'Té'],
    ['Ñoquis', 'Ravioles'], ['Fideos', 'Arroz'], ['Hamburguesa', 'Pancho'], ['Sushi', 'Ceviche'],
    ['Provoleta', 'Fondue'], ['Chimichurri', 'Salsa criolla'], ['Locro', 'Guiso de lentejas'], ['Flan', 'Budín de pan'],
    ['Chocotorta', 'Tiramisú'], ['Mostaza', 'Kétchup'], ['Palta', 'Aceituna'], ['Queso', 'Manteca'],
    ['Vino', 'Cerveza'], ['Agua', 'Soda'], ['Sandía', 'Melón'], ['Frutilla', 'Cereza'],
    ['Naranja', 'Mandarina'], ['Limón', 'Pomelo'], ['Papa', 'Batata'], ['Zanahoria', 'Zapallo'],
    ['Lechuga', 'Rúcula'], ['Tostado', 'Sándwich de miga'], ['Pochoclo', 'Maní'], ['Chipá', 'Bizcochito de grasa'],
    ['Churros', 'Buñuelos'], ['Torta frita', 'Sopaipilla'], ['Lomito', 'Bife de chorizo'], ['Matambre', 'Vacío'],
    ['Morcilla', 'Chorizo'], ['Ensalada rusa', 'Ensalada de papa'], ['Tortilla de papa', 'Omelette'], ['Panqueques', 'Waffles'],
    ['Yogur', 'Leche chocolatada'], ['Pan dulce', 'Budín inglés'], ['Torta', 'Bizcochuelo'], ['Humita', 'Tamal'],
    ['Pastel de papa', 'Lasaña'], ['Sorrentinos', 'Canelones'], ['Picada', 'Tabla de quesos'], ['Mollejas', 'Chinchulines'],
    // Oficina y trabajo
    ['Oficina', 'Coworking'], ['Reunión', 'Videollamada'], ['Mail', 'Chat'], ['Excel', 'Word'],
    ['Jefe', 'Gerente'], ['Impresora', 'Escáner'], ['Teclado', 'Mouse'], ['Monitor', 'Notebook'],
    ['Escritorio', 'Mesa de reuniones'], ['Silla', 'Banqueta'], ['Lapicera', 'Lápiz'], ['Cuaderno', 'Agenda'],
    ['Post-it', 'Resaltador'], ['Abrochadora', 'Clip'], ['Cafetera', 'Pava eléctrica'], ['Ascensor', 'Escalera mecánica'],
    ['Feriado', 'Vacaciones'], ['Sueldo', 'Aguinaldo'], ['Teletrabajo', 'Viaje de trabajo'], ['Planilla', 'Informe'],
    ['Presentación', 'Capacitación'], ['Almuerzo', 'Merienda'], ['Recepción', 'Sala de espera'], ['Contraseña', 'PIN'],
    ['Wi-Fi', 'Bluetooth'], ['Celular', 'Tablet'], ['Cargador', 'Batería portátil'], ['Auriculares', 'Parlante'],
    ['Calendario', 'Reloj'], ['Pizarra', 'Proyector'], ['Cliente', 'Proveedor'], ['Factura', 'Recibo'],
    ['After office', 'Cena de fin de año'], ['Cumpleaños de oficina', 'Despedida'], ['Lunes', 'Viernes'], ['Tarjeta de acceso', 'Llave'],
    // Deportes y aire libre
    ['Fútbol', 'Rugby'], ['Pádel', 'Tenis'], ['Básquet', 'Vóley'], ['Bicicleta', 'Monopatín'],
    ['Trekking', 'Escalada'], ['Running', 'Caminata'], ['Natación', 'Waterpolo'], ['Golf', 'Minigolf'],
    ['Ping-pong', 'Bádminton'], ['Ajedrez', 'Damas'], ['Gimnasio', 'Club'], ['Yoga', 'Pilates'],
    ['Arquero', 'Defensor'], ['Gol', 'Penal'], ['Árbitro', 'VAR'], ['Camiseta', 'Botines'],
    ['Pelota', 'Paleta'], ['Medalla', 'Copa'], ['Maratón', 'Triatlón'], ['Montaña', 'Volcán'],
    ['Carpa', 'Bolsa de dormir'], ['Mochila', 'Riñonera'], ['Casco', 'Rodilleras'], ['Esquí', 'Snowboard'],
    ['Surf', 'Kitesurf'], ['Kayak', 'Canoa'], ['Hockey', 'Polo'], ['Mountain bike', 'Bici de ruta'],
    ['Picnic', 'Camping'], ['Fogón', 'Parrilla'],
    // Argentina
    ['Obelisco', 'Planetario'], ['Bariloche', 'San Martín de los Andes'], ['Mar del Plata', 'Pinamar'], ['Mendoza', 'San Juan'],
    ['Córdoba', 'Rosario'], ['Cataratas del Iguazú', 'Esteros del Iberá'], ['Glaciar', 'Iceberg'], ['Tango', 'Milonga'],
    ['Chacarera', 'Chamamé'], ['Colectivo', 'Subte'], ['Tren', 'Tranvía'], ['Remis', 'Taxi'],
    ['Truco', 'Chinchón'], ['Gaucho', 'Peón de campo'], ['Boleadoras', 'Lazo'], ['Poncho', 'Bufanda'],
    ['Bombilla', 'Termo'], ['Yerba', 'Té en saquito'], ['Bandoneón', 'Acordeón'], ['Cuarteto', 'Cumbia'],
    ['Patagonia', 'Puna'], ['Quebrada de Humahuaca', 'Valle de la Luna'],
    // Vida cotidiana
    ['Playa', 'Pileta'], ['Sol', 'Luna'], ['Lluvia', 'Granizo'], ['Paraguas', 'Piloto'],
    ['Invierno', 'Otoño'], ['Perro', 'Gato'], ['Caballo', 'Burro'], ['Vaca', 'Toro'],
    ['Pingüino', 'Foca'], ['León', 'Tigre'], ['Ballena', 'Delfín'], ['Águila', 'Cóndor'],
    ['Hormiga', 'Abeja'], ['Mariposa', 'Polilla'], ['Auto', 'Camioneta'], ['Moto', 'Cuatriciclo'],
    ['Avión', 'Helicóptero'], ['Barco', 'Lancha'], ['Cine', 'Teatro'], ['Libro', 'Revista'],
    ['Diario', 'Radio'], ['Serie', 'Película'], ['Guitarra', 'Bajo'], ['Piano', 'Órgano'],
    ['Batería', 'Bongó'], ['Cumpleaños', 'Aniversario'], ['Casamiento', 'Fiesta de quince'], ['Regalo', 'Sorpresa'],
    ['Vela', 'Linterna'], ['Heladera', 'Freezer'], ['Microondas', 'Horno'], ['Lavarropas', 'Secarropas'],
    ['Sillón', 'Puff'], ['Cama', 'Hamaca paraguaya'], ['Almohada', 'Almohadón'], ['Ducha', 'Bañera'],
    ['Cepillo de dientes', 'Hilo dental'], ['Jabón', 'Shampoo'], ['Remera', 'Camisa'], ['Zapatillas', 'Ojotas'],
    ['Campera', 'Buzo'], ['Anteojos', 'Lentes de contacto'], ['Reloj pulsera', 'Pulsera'], ['Candado', 'Cerradura'],
    ['Ventana', 'Puerta'], ['Balcón', 'Terraza'], ['Jardín', 'Huerta'], ['Plaza', 'Parque'],
    ['Hospital', 'Farmacia'], ['Escuela', 'Universidad'], ['Supermercado', 'Almacén'], ['Kiosco', 'Verdulería'],
    ['Banco', 'Cajero automático'], ['Carta', 'Postal'], ['Foto', 'Video'], ['Selfie', 'Retrato'],
    ['Montaña rusa', 'Vuelta al mundo'], ['Circo', 'Zoológico'], ['Museo', 'Galería de arte'], ['Biblioteca', 'Librería'],
    ['Isla', 'Península'], ['Río', 'Lago'], ['Mar', 'Océano'], ['Bosque', 'Selva'],
    ['Desierto', 'Salina'], ['Nieve', 'Hielo'], ['Rayo', 'Trueno'], ['Mascota', 'Peluche'],
  ];

  const Palabras = pares.map(function (p) { return { palabra: p[0], impostor: p[1] }; });

  if (typeof module !== 'undefined' && module.exports) module.exports = Palabras;
  else g.Palabras = Palabras;
})(this);
