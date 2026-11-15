// Palabras del Pictionary (37): cosas que se puedan dibujar en un minuto, en castellano rioplatense. La base las tiene
// en pictionary_palabras (dev/supabase/37-pictionary.sql las carga); este archivo es la fuente para revisarlas y tests.
(function (g) {
  const PALABRAS = [
    // comida y bebida
    'mate', 'asado', 'empanada', 'choripán', 'pizza', 'helado', 'alfajor', 'medialuna', 'milanesa', 'fernet',
    'parrilla', 'sandía', 'banana', 'manzana', 'torta', 'café', 'pochoclo', 'hamburguesa', 'huevo frito', 'facturas',
    // casa y objetos
    'paraguas', 'reloj', 'lámpara', 'tijera', 'llave', 'anteojos', 'zapatilla', 'guitarra', 'televisor', 'heladera',
    'escalera', 'ventana', 'puerta', 'cama', 'silla', 'mesa', 'vela', 'termo', 'mochila', 'billetera',
    'celular', 'computadora', 'auriculares', 'cámara de fotos', 'martillo', 'tornillo', 'escoba', 'balde', 'regalo', 'globo',
    // lugares y transporte
    'colectivo', 'subte', 'bicicleta', 'avión', 'barco', 'tren', 'auto', 'moto', 'helicóptero', 'semáforo',
    'faro', 'puente', 'castillo', 'carpa', 'pileta', 'playa', 'montaña', 'volcán', 'isla', 'obelisco',
    // animales
    'perro', 'gato', 'caballo', 'vaca', 'pingüino', 'jirafa', 'elefante', 'tiburón', 'pulpo', 'caracol',
    'mariposa', 'araña', 'serpiente', 'tortuga', 'conejo', 'búho', 'carpincho', 'cocodrilo', 'murciélago', 'abeja',
    // deportes y juegos
    'pelota', 'arco', 'raqueta', 'pádel', 'trofeo', 'medalla', 'silbato', 'dados', 'ajedrez', 'naipes',
    'bowling', 'surf', 'esquí', 'pesca', 'boxeo', 'golf', 'básquet', 'remo', 'paracaídas', 'patineta',
    // naturaleza y otros
    'sol', 'luna', 'estrella', 'nube', 'lluvia', 'rayo', 'arcoíris', 'árbol', 'flor', 'cactus',
    'fantasma', 'robot', 'pirata', 'astronauta', 'sirena', 'dragón', 'corona', 'espada', 'tesoro', 'mapa',
    'cohete', 'muñeco de nieve', 'bombero', 'médico', 'cocinero', 'mago', 'payaso', 'detective', 'oficina', 'reunión',
  ];
  const Pictionary = { PALABRAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Pictionary;
  else g.PictionaryPalabras = Pictionary;
})(typeof window !== 'undefined' ? window : globalThis);
