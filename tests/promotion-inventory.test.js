const mockProducto = {
  findById: jest.fn(),
  find: jest.fn()
};

jest.mock('../src/models-mongo/product', () => mockProducto);

const {
  normalizarUnidades,
  resolverPromocion,
  sincronizarPromociones
} = require('../src/services/promotionInventory');

describe('inventario de promociones', () => {
  beforeEach(() => jest.clearAllMocks());

  test('valida que una promoción consuma al menos dos unidades', () => {
    expect(normalizarUnidades(3)).toBe(3);
    expect(normalizarUnidades('2')).toBe(2);
    expect(normalizarUnidades(1)).toBeNull();
    expect(normalizarUnidades(2.5)).toBeNull();
  });

  test('resuelve el producto base y el multiplicador de inventario', async () => {
    const base = { _id: 'base-1', stock: 8, solo_encargo: false };
    const exec = jest.fn().mockResolvedValue(base);
    const session = jest.fn().mockReturnValue({ exec });
    mockProducto.findById.mockReturnValue({ session });

    const result = await resolverPromocion({
      nombre: 'Oferta 3 cajas',
      producto_base: 'base-1',
      unidades_por_venta: 3
    }, { session: 'tx' });

    expect(result).toEqual({ productoInventario: base, unidades: 3, esPromocion: true });
    expect(session).toHaveBeenCalledWith('tx');
  });

  test('calcula cuántas promociones pueden venderse desde el stock base', async () => {
    const promocion = {
      _id: 'promo-1',
      stock: 9,
      unidades_por_venta: 3,
      save: jest.fn().mockResolvedValue(undefined)
    };
    mockProducto.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([promocion]) });

    const events = await sincronizarPromociones('base-1', 5);

    expect(promocion.stock).toBe(1);
    expect(promocion.save).toHaveBeenCalled();
    expect(events).toEqual([{ productoId: 'promo-1', nuevoStock: 1 }]);
  });
});
