/* eslint-env browser */

// Provides a function `el` that enables a declarative syntax for DOM generation
// in plain javascript. The first argument is what type of element to create.
// The subsequent arguments are appended as child nodes. If the "child" argument
// is a function, it is executed in the context of the parent node.

// By nesting `el` calls we have a plain javascript alternative to HTML that
// also allows for inline logic. This unifies the DOM and closure hierarchy,
// creating a single consistent context for UI creation.

// When an Observer from reactor.js is passed as a child argument, it's return
// is automatically attached to the parent each time the observer triggers,
// replacing the previous iterations if any. Attached Observers are also
// automatically disabled when their parent element is removed from the DOM.

import { Observer, shuck } from './reactor.js'

// Manually compiled list of valid HTML tags. Used when creating a new `el`
// If the string matches a named tag it will create that element
// If it does not match it will just make a div with the string as a class name
const VALID_HTML_TAGS = Object.freeze([
  'a', 'abbr', 'acronym', 'address', 'applet', 'area', 'article', 'aside', 'audio',
  'b', 'bdi', 'base', 'basefont', 'bdo', 'big', 'blockquote', 'body', 'br', 'button',
  'canvas', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'command',
  'data', 'datagrid', 'datalist', 'dd', 'del', 'details', 'dfn', 'dir', 'div', 'dl', 'dt',
  'em', 'embed', 'eventsource',
  'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form', 'frame', 'frameset',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html',
  'i', 'iframe', 'img', 'input', 'ins', 'isindex',
  'kbd', 'keygen',
  'label', 'legend', 'li', 'link',
  'mark', 'map', 'menu', 'meta', 'meter',
  'nav',
  'noframes', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'param', 'pre', 'progress',
  'q',
  'ruby', 'rp', 'rt',
  's', 'samp', 'script', 'section', 'select', 'small', 'source', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'tt',
  'u', 'ul',
  'var', 'video',
  'wbr'
])

// Whenever an element is added to the DOM turn its observers on
// Whenever an element is removed from the DOM turn its observers off
// This avoids leaking "orphan" observers that stay alive updating nodes that
// no longer are relevant.
// Note: MutationObserver is native class and unrelated to reactor.js observers
const docObserver = new MutationObserver((mutationList, mutationObserver) => {
  for (const mutationRecord of mutationList) {
    for (const addedNode of Array.from(mutationRecord.addedNodes)) {
      const comments = getAllComments(addedNode)
      for (const comment of comments) {
        observerTrios.get(comment)?.observer.start()
      }
    }
    for (const removedNode of Array.from(mutationRecord.removedNodes)) {
      const comments = getAllComments(removedNode)
      for (const comment of comments) {
        observerTrios.get(comment)?.observer.stop()
      }
    }
  }
})
docObserver.observe(document, { subtree: true, childList: true })

// When an observer is attached to an element, a pair of comment nodes are
// created to mark the "location" of the observer within the parent.
// These comments are meant to act as proxies for the observer within the DOM.
// When a comment is removed, so is its partner and the observer they represent
// This defines the MutationObserver but it is only activated on the creation of
// each `el` element.
const observerTrios = new WeakMap()
const bookmarkObserver = new MutationObserver((mutationList, mutationObserver) => {
  for (const mutationRecord of mutationList) {
    for (const removedNode of Array.from(mutationRecord.removedNodes)) {
      observerTrios.get(removedNode)?.clear()
    }
  }
})

// Helper function to get all comment nodes for a given subtree
function getAllComments (root) {
  const commentIterator = document.createNodeIterator(
    root,
    NodeFilter.SHOW_COMMENT,
    () => NodeFilter.FILTER_ACCEPT
  )
  const commentList = []
  let nextComment = commentIterator.nextNode()
  while (nextComment !== null) {
    commentList.push(nextComment)
    nextComment = commentIterator.nextNode()
  }
  return commentList
}

// Helper function to get all nodes between 2 nodes
function getNodesBetween (startNode, endNode) {
  if (
    startNode.parentNode === null ||
    endNode.parentNode === null ||
    startNode.parentNode !== endNode.parentNode
  ) throw new RangeError('endNode could not be reached from startNode')
  const result = []
  let currentNode = startNode.nextSibling
  while (currentNode !== endNode) {
    if (currentNode === null) {
      throw new RangeError('endNode could not be reached from startNode')
    }
    result.push(currentNode)
    currentNode = currentNode.nextSibling
  }
  return result
}

// Simple check for a query selector over creating a tag
// Problem is that a plain text string is a valid tag search
// We check for the common cases of . # and [
// Just skip starting with tag search
// TODO improve this to actually detect valid query selector
const isQuerySelector = (testString) => (
  typeof testString === 'string' && (
    testString.startsWith('.') ||
    testString.startsWith('#') ||
    testString.startsWith('[')
  )
)

// Main magic element wrapping function
// First argument is the element to create or wrap
// Subsequent arguments are children to attach
// Returns the element with all the stuff attached
const el = (descriptor, ...children) => {
  // Create the new element or wrap an existing one
  // If its an existing element dont do anything
  let self
  // Trivial case when given an element
  if (descriptor instanceof Element) {
    self = descriptor
  // If its a selector then find the thing
  } else if (isQuerySelector(descriptor)) {
    self = document.querySelector(descriptor)
  // If its a valid html tag, then make a new html tag and add classes
  // Default to div otherwise
  } else if (typeof descriptor === 'string') {
    const firstWord = descriptor.split(' ')[0]
    const tag = VALID_HTML_TAGS.includes(firstWord) ? firstWord : 'div'
    const newElement = document.createElement(tag)
    newElement.className = descriptor
    self = newElement
  } else {
    throw new TypeError('el descriptor expects a string or an existing Element')
  }

  // Attach the MutationObserver to cleanly remove observer markers
  bookmarkObserver.observe(self, { childList: true })

  // For the children
  // If its a string, then just append it as a text node child
  // If its an existing element, then append it as a child
  // If its a function, execute it in the context. Append return values
  // If its an observer then append a pair of comment nodes as placeholders
  // The contents of the observer will be inserted between the placeholders
  // If it is an array, decompose it and try to add each of its elements
  // If it is a Promise, add a comment placeholder which will be replaced
  // when the promise returns
  function append (child, insertionPoint) {
    // If the insertion point given is no longer attached
    // Then abort the insertion
    if (insertionPoint && insertionPoint.parentElement !== self) return false
    // Handle the null case
    if (typeof child === 'undefined' || child === null) return false
    // Strings are just appended as text
    if (typeof child === 'string') {
      const textNode = document.createTextNode(child)
      self.insertBefore(textNode, insertionPoint)
    // Existing elements are just appended
    } else if (child instanceof Element || child instanceof DocumentFragment) {
      self.insertBefore(shuck(child), insertionPoint)
    // Promises get an immediate placeholder before they resolve
    // If the placeholder is removed before the promise resolves. Nothing happens
    // With observers, this means only the latest promise will get handled
    } else if (child instanceof Promise) {
      const promisePlaceholder = document.createComment('promisePlaceholder')
      self.insertBefore(promisePlaceholder, insertionPoint)
      child.then(value => {
        append(value, promisePlaceholder)
        promisePlaceholder.remove()
      })
    // When an Observers is appended we insert comment nodes as "bookends" to
    // mark its position. On initial commitment Observers work like normal
    // functions. They execute and the return value if any is appended between
    // the bookends. On subsequent triggers, everything between the bookends
    // is first cleared before the new result is appended
    } else if (child instanceof Observer) {
      // Start with the bookends marking the observer domain
      // Keep a mapping of the bookends to the observer
      // Lets the observer be cleaned up later when the any comment is removed
      const observerStartNode = document.createComment('observerStart')
      const observerEndNode = document.createComment('observerEnd')
      self.insertBefore(observerStartNode, insertionPoint)
      self.insertBefore(observerEndNode, insertionPoint)
      const observerTrio = {
        start: observerStartNode,
        end: observerEndNode,
        observer: child,
        clear: function () {
          this.start.remove()
          this.end.remove()
          this.observer.stop()
        }
      }
      observerTrios.set(observerStartNode, observerTrio)
      observerTrios.set(observerEndNode, observerTrio)
      observerTrios.set(child, observerTrio)
      // Create meta-observer to observe the observer
      // When the observer returns a new value
      // The meta-observer appends the results
      // This pattern is used so that the library user can write observers
      // just returning a value and not worry about the attachment logic
      // TODO - group meta-observer with the rest of it to be cleared together
      new Observer(() => {
        // Since the child is an Observer and Observers values are Signals
        // reading the value here binds the meta-observer to retrigger whenever
        // the child observer retriggers
        const result = child.value
        // Check if the bookmarks are still attached before acting
        if (
          observerStartNode.parentNode === self &&
          observerEndNode.parentNode === self
        ) {
          // Clear everything between the bookmarks
          const oldChildren = getNodesBetween(observerStartNode, observerEndNode)
          for (const oldChild of oldChildren) oldChild.remove()
          // Then insert new content between them
          append(result, observerEndNode)
        }
        // If either of the bookmarks is missing or no longer attached something
        // weird has happened so do nothing
        // In theory the comment observer should detect the missing comment and
        // remove the other one and disable the observer
      }).start()
      // Kickoff the child observer with a context of self
      // If it is not yet in the document then stop observer from triggering further
      child.setThisContext(self)
      child.setArgsContext(self)
      child.stop()
      child.start()
      if (!document.contains(self)) child.stop()

    // When a normal function is provided it is executed immediately and its
    // output (if any) is appended.
    // The function has access to the parent element via either `this` for
    // traditional functions or by the first argument for arrow functions
    // e.g. (ctx) => {...}
    // Need this condition to come after Observers since they are functions too
    } else if (typeof child === 'function') {
      const result = child.call(self, self)
      append(result, insertionPoint)
    // Arrays are handled recursively
    // Works for any sort of iterable
    } else if (typeof child?.[Symbol.iterator] === 'function') {
      for (const grandChild of child) {
        append(grandChild, insertionPoint)
      }
    // Anything else isnt meant to be appended
    } else {
      throw new TypeError('expects string, function, an Element, or an Array of them')
    }
    // If it successfully appended something return true
    return true
  }
  children.forEach((child) => append(child))

  // Return the raw DOM element
  // Magic wrapping held in a pocket dimension outside of time and space
  return self
}

// Shorthand for setting an attribute
// el('foo', attr('id', 'bar'))
function attr (attribute, value) {
  return ($) => {
    $.setAttribute(attribute, value)
  }
}

// Shorthand for 2-way binding to a reactor
// el('input', attr('type', 'text'), bind(rx, 'foo'))
function bind (reactor, key) {
  return ($) => {
    $.oninput = () => { reactor[key] = $.value }
    return new Observer(() => { $.value = reactor[key] })
  }
}

// Shorthand for making new observers
const ob = (x) => new Observer(x)

export {
  el,
  ob,
  attr,
  bind
}
