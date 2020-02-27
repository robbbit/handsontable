import {
  addClass,
  removeClass,
  fastInnerHTML,
  empty,
} from '../../helpers/dom/element';
import { arrayEach } from '../../helpers/array';
import { toSingleLine } from '../../helpers/templateLiteralTag';
import { warn } from '../../helpers/console';
import { registerPlugin } from '../../plugins';
import BasePlugin from '../_base';
import ColumnStatesManager from './columnStatesManager';
import GhostTable from './utils/ghostTable';

import './nestedHeaders.css';

/**
 * @plugin NestedHeaders
 * @description
 * The plugin allows to create a nested header structure, using the HTML's colspan attribute.
 *
 * To make any header wider (covering multiple table columns), it's corresponding configuration array element should be
 * provided as an object with `label` and `colspan` properties. The `label` property defines the header's label,
 * while the `colspan` property defines a number of columns that the header should cover.
 *
 * __Note__ that the plugin supports a *nested* structure, which means, any header cannot be wider than it's "parent". In
 * other words, headers cannot overlap each other.
 * @example
 *
 * ```js
 * const container = document.getElementById('example');
 * const hot = new Handsontable(container, {
 *   date: getData(),
 *   nestedHeaders: [
 *           ['A', {label: 'B', colspan: 8}, 'C'],
 *           ['D', {label: 'E', colspan: 4}, {label: 'F', colspan: 4}, 'G'],
 *           ['H', {label: 'I', colspan: 2}, {label: 'J', colspan: 2}, {label: 'K', colspan: 2}, {label: 'L', colspan: 2}, 'M'],
 *           ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W']
 *  ],
 * ```
 */
class NestedHeaders extends BasePlugin {
  /**
   * Array of nested headers' colspans.
   *
   * @private
   * @type {Array}
   */
  #columnStatesManager = new ColumnStatesManager();
  /**
   * Custom helper for getting widths of the nested headers.
   *
   * @private
   * @type {GhostTable}
   */
  // @TODO This should be changed after refactor handsontable/utils/ghostTable.
  ghostTable = new GhostTable(this);

  /**
   * Check if plugin is enabled.
   *
   * @returns {boolean}
   */
  isEnabled() {
    return !!this.hot.getSettings().nestedHeaders;
  }

  /**
   * Enables the plugin functionality for this Handsontable instance.
   */
  enablePlugin() {
    if (this.enabled) {
      return;
    }

    const nestedHeaders = this.hot.getSettings().nestedHeaders;

    if (Array.isArray(nestedHeaders)) {
      const hasError = this.#columnStatesManager.setState(nestedHeaders);

      if (hasError) {
        warn(toSingleLine`Your Nested Headers plugin setup contains overlapping headers. This kind of configuration\x20
                          is currently not supported.`);
      }
    }

    this.addHook('afterInit', () => this.onAfterInit());
    this.addHook('afterOnCellMouseDown', (event, coords) => this.onAfterOnCellMouseDown(event, coords));
    this.addHook('beforeOnCellMouseOver', (event, coords, TD, blockCalculations) => this.onBeforeOnCellMouseOver(event, coords, TD, blockCalculations));
    this.addHook('afterGetColumnHeaderRenderers', array => this.onAfterGetColumnHeaderRenderers(array));
    this.addHook('modifyColWidth', (width, column) => this.onModifyColWidth(width, column));
    this.addHook('afterViewportColumnCalculatorOverride', calc => this.onAfterViewportColumnCalculatorOverride(calc));

    super.enablePlugin();
  }

  /**
   * Disables the plugin functionality for this Handsontable instance.
   */
  disablePlugin() {
    this.clearColspans();
    this.#columnStatesManager.clear();
    this.ghostTable.clear();

    super.disablePlugin();
  }

  /**
   * Updates the plugin state. This method is executed when {@link Core#updateSettings} is invoked.
   */
  updatePlugin() {
    this.disablePlugin();
    this.enablePlugin();

    super.updatePlugin();
    this.ghostTable.buildWidthsMapper();
  }

  /**
   * Gets a total number of headers levels.
   *
   * @private
   * @returns {number}
   */
  getLayersCount() {
    return this.#columnStatesManager.getLayersCount();
  }

  /**
   * Gets column settings for a specified header. The returned object contains
   * information about the header label, its colspan length, or if it is hidden
   * in the header renderers.
   *
   * @private
   * @param {number} visualColumnIndex A visual column index.
   * @param {number} headerLevel Header level (0 = most distant to the table).
   * @returns {object}
   */
  getColumnSettings(visualColumnIndex, headerLevel) {
    return this.#columnStatesManager.getColumnSettings(visualColumnIndex, headerLevel);
  }

  /**
   * Gets HTML elements for specified visual column index and header level from
   * all overlays except master.
   *
   * @private
   * @param {number} visualColumnIndex A visual column index.
   * @param {number} headerLevel Header level (0 = most distant to the table).
   * @returns {HTMLElement[]}
   */
  getColumnHeaders(visualColumnIndex, headerLevel) {
    const { wtOverlays } = this.hot.view.wt;

    return [
      wtOverlays.topOverlay?.clone.wtTable.getColumnHeader(visualColumnIndex, headerLevel),
      wtOverlays.topLeftCornerOverlay?.clone.wtTable.getColumnHeader(visualColumnIndex, headerLevel),
    ].filter(element => element !== void 0);
  }

  /**
   * Clear the colspans remaining after plugin usage.
   *
   * @private
   */
  clearColspans() {
    if (!this.hot.view) {
      return;
    }

    const { wt } = this.hot.view;
    const headerLevels = wt.getSetting('columnHeaders').length;
    const mainHeaders = wt.wtTable.THEAD;
    const topHeaders = wt.wtOverlays.topOverlay.clone.wtTable.THEAD;
    const topLeftCornerHeaders = wt.wtOverlays.topLeftCornerOverlay ?
      wt.wtOverlays.topLeftCornerOverlay.clone.wtTable.THEAD : null;

    for (let i = 0; i < headerLevels; i++) {
      const masterLevel = mainHeaders.childNodes[i];

      if (!masterLevel) {
        break;
      }

      const topLevel = topHeaders.childNodes[i];
      const topLeftCornerLevel = topLeftCornerHeaders ? topLeftCornerHeaders.childNodes[i] : null;

      for (let j = 0, masterNodes = masterLevel.childNodes.length; j < masterNodes; j++) {
        masterLevel.childNodes[j].removeAttribute('colspan');
        removeClass(masterLevel.childNodes[j], 'hiddenHeader');

        if (topLevel && topLevel.childNodes[j]) {
          topLevel.childNodes[j].removeAttribute('colspan');
          removeClass(topLevel.childNodes[j], 'hiddenHeader');
        }

        if (topLeftCornerHeaders && topLeftCornerLevel && topLeftCornerLevel.childNodes[j]) {
          topLeftCornerLevel.childNodes[j].removeAttribute('colspan');
          removeClass(topLeftCornerLevel.childNodes[j], 'hiddenHeader');
        }
      }
    }
  }

  /**
   * Generates the appropriate header renderer for a header row.
   *
   * @private
   * @param {number} headerLevel The index of header level counting from the top (positive values counting from 0 to N).
   * @returns {Function}
   * @fires Hooks#afterGetColHeader
   */
  headerRendererFactory(headerLevel) {
    const fixedColumnsLeft = this.hot.getSettings().fixedColumnsLeft || 0;

    return (renderedColumnIndex, TH) => {
      const { rootDocument, columnIndexMapper, view } = this.hot;

      let visualColumnsIndex = columnIndexMapper.getVisualFromRenderableIndex(renderedColumnIndex);

      if (visualColumnsIndex === null) {
        visualColumnsIndex = renderedColumnIndex;
      }

      TH.removeAttribute('colspan');
      removeClass(TH, 'hiddenHeader');

      const { colspan, label, hidden } = this.#columnStatesManager.getColumnSettings(visualColumnsIndex, headerLevel);

      if (hidden) {
        addClass(TH, 'hiddenHeader');
      }

      if (colspan > 1) {
        const isTopLeftOverlay = view.wt.wtOverlays.topLeftCornerOverlay?.clone.wtTable.THEAD.contains(TH);

        TH.setAttribute('colspan', isTopLeftOverlay ? Math.min(colspan, fixedColumnsLeft - renderedColumnIndex) : colspan);
      }

      const divEl = rootDocument.createElement('div');
      const spanEl = rootDocument.createElement('span');

      addClass(divEl, 'relative');
      addClass(spanEl, 'colHeader');
      fastInnerHTML(spanEl, label);

      divEl.appendChild(spanEl);

      empty(TH);
      TH.appendChild(divEl);

      this.hot.runHooks('afterGetColHeader', visualColumnsIndex, TH);
    };
  }

  /**
   * Updates headers highlight in nested structure.
   *
   * @private
   */
  updateHeadersHighlight() {
    const { hot } = this;
    const selection = hot.getSelectedRangeLast();

    if (selection === void 0) {
      return;
    }

    const hotSettings = this.hot.getSettings();
    const classNameModifier = className => (TH, modifier) => () => modifier(TH, className);
    const highlightHeader = classNameModifier(hotSettings.currentHeaderClassName);
    const activeHeader = classNameModifier(hotSettings.activeHeaderClassName);

    const selectionByHeader = hot.selection.isSelectedByColumnHeader();
    const layersCount = this.#columnStatesManager.getLayersCount();
    const { col: columnFrom } = selection.getTopLeftCorner();
    const { col: columnTo } = selection.getTopRightCorner();
    const columnSelectionWidth = columnTo - columnFrom + 1;
    const changes = [];

    let columnWalker = 0;

    for (let column = columnFrom; column <= columnTo; column++) {
      // Traverse header layers from bottom to top.
      for (let level = layersCount - 1; level > -1; level--) {
        const { origColspan, hidden } = this.#columnStatesManager.getColumnSettings(column, level);
        const isFirstLayer = level === layersCount - 1;
        let isOutOfRange = (columnWalker + origColspan) > columnSelectionWidth;

        // If the selection doesn't overlap, the whole colspaned header. Correct the
        // visual column index to the TH element, which is not hidden (most left column index).
        if (columnWalker === 0 && isFirstLayer && hidden) {
          isOutOfRange = false;
          column = this.#columnStatesManager.findLeftMostColumnIndex(column, level);
        }

        const THs = this.getColumnHeaders(column, level);

        arrayEach(THs, (TH) => {
          if (isOutOfRange) {
            changes.push(activeHeader(TH, removeClass));
            changes.push(highlightHeader(TH, removeClass));

          } else if (selectionByHeader && !hidden) {
            changes.push(activeHeader(TH, addClass));
            changes.push(highlightHeader(TH, addClass));

          } else if (isFirstLayer) {
            changes.push(highlightHeader(TH, addClass));

          } else {
            changes.push(highlightHeader(TH, removeClass));
          }
        });
      }

      columnWalker += 1;
    }

    arrayEach(changes, fn => void fn());
  }

  /**
   * Cache column header count.
   *
   * @private
   */
  onAfterInit() {
    this.ghostTable.buildWidthsMapper();
  }

  /**
   * Select all nested headers of clicked cell.
   *
   * @private
   * @param {MouseEvent} event Mouse event.
   * @param {CellCoords} coords Clicked cell coords.
   */
  onAfterOnCellMouseDown(event, coords) {
    if (coords.row < 0) {
      const { colspan } = this.#columnStatesManager.getColumnSettings(coords.col, coords.row);

      if (colspan > 1) {
        this.hot.selection.selectColumns(coords.col, coords.col + colspan - 1);
      }
    }
  }

  /**
   * Make the header-selection properly select the nested headers.
   *
   * @private
   * @param {MouseEvent} event Mouse event.
   * @param {CellCoords} coords Clicked cell coords.
   * @param {HTMLElement} TD The cell element.
   * @param {object} blockCalculations An object which allows or disallows changing the selection for the particular axies.
   */
  onBeforeOnCellMouseOver(event, coords, TD, blockCalculations) {
    if (coords.row >= 0 || coords.col < 0 || !this.hot.view.isMouseDown()) {
      return;
    }

    const { from, to } = this.hot.getSelectedRangeLast();
    const { colspan } = this.#columnStatesManager.getColumnSettings(coords.col, coords.row);
    const lastColIndex = coords.col + colspan - 1;
    let changeDirection = false;

    if (from.col <= to.col) {
      if ((coords.col < from.col && lastColIndex === to.col) ||
          (coords.col < from.col && lastColIndex < from.col) ||
          (coords.col < from.col && lastColIndex >= from.col && lastColIndex < to.col)) {
        changeDirection = true;
      }
    } else if ((coords.col < to.col && lastColIndex > from.col) ||
               (coords.col > from.col) ||
               (coords.col <= to.col && lastColIndex > from.col) ||
               (coords.col > to.col && lastColIndex > from.col)) {
      changeDirection = true;
    }

    if (changeDirection) {
      [from.col, to.col] = [to.col, from.col];
    }

    if (colspan > 1) {
      blockCalculations.column = true;
      blockCalculations.cell = true;

      const columnRange = [];

      if (from.col === to.col) {
        if (lastColIndex <= from.col && coords.col < from.col) {
          columnRange.push(to.col, coords.col);
        } else {
          columnRange.push(coords.col < from.col ? coords.col : from.col, lastColIndex > to.col ? lastColIndex : to.col);
        }
      }
      if (from.col < to.col) {
        columnRange.push(coords.col < from.col ? coords.col : from.col, lastColIndex);

      }
      if (from.col > to.col) {
        columnRange.push(from.col, coords.col);
      }

      this.hot.selectColumns(...columnRange);
    }
  }

  /**
   * `afterGetColumnHeader` hook callback - prepares the header structure.
   *
   * @private
   * @param {Array} renderersArray Array of renderers.
   */
  onAfterGetColumnHeaderRenderers(renderersArray) {
    if (renderersArray) {
      renderersArray.length = 0;

      for (let headerLayer = 0; headerLayer < this.#columnStatesManager.getLayersCount(); headerLayer++) {
        renderersArray.push(this.headerRendererFactory(headerLayer));
      }
    }

    this.updateHeadersHighlight();
  }

  /**
   * Make the renderer render the first nested column in its entirety.
   *
   * @private
   * @param {object} calc Viewport column calculator.
   */
  onAfterViewportColumnCalculatorOverride(calc) {
    let newStartColumn = calc.startColumn;

    for (let headerLayer = 0; headerLayer < this.#columnStatesManager.getLayersCount(); headerLayer++) {
      const startColumnNestedParent = this.#columnStatesManager.findLeftMostColumnIndex(calc.startColumn, headerLayer);

      if (startColumnNestedParent < calc.startColumn) {
        newStartColumn = startColumnNestedParent;
        break;
      }
    }

    calc.startColumn = newStartColumn;
  }

  /**
   * `modifyColWidth` hook callback - returns width from cache, when is greater than incoming from hook.
   *
   * @private
   * @param {number} width Width from hook.
   * @param {number} column Visual index of an column.
   * @returns {number}
   */
  onModifyColWidth(width, column) {
    const cachedWidth = this.ghostTable.widthsCache[column];

    return width > cachedWidth ? width : cachedWidth;
  }

  /**
   * Destroys the plugin instance.
   */
  destroy() {
    this.#columnStatesManager = null;
    this.ghostTable = null;

    super.destroy();
  }

}

registerPlugin('nestedHeaders', NestedHeaders);

export default NestedHeaders;
